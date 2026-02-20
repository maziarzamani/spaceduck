import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, parse as parsePath } from "node:path";
import { SttError, type SttErrorCode } from "./stt-error";

export interface TranscribeResult {
  text: string;
  language: string;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export interface TranscribeOptions {
  languageHint?: string;
  model?: string;
  timeoutMs?: number;
}

export interface AvailabilityResult {
  ok: boolean;
  reason?: string;
}

export type SubprocessRunner = (
  args: string[],
  opts: { timeoutMs: number; cwd?: string },
) => Promise<{ exitCode: number; stderr: string }>;

const DEFAULT_MODEL = "small";
const DEFAULT_TIMEOUT_MS = 300_000;
const HELP_TIMEOUT_MS = 3_000;

/**
 * Resolve the whisper binary path without depending on `which`.
 * 1. SPACEDUCK_WHISPER_PATH env var (explicit override)
 * 2. Bun.which("whisper") if available
 * 3. Fall back to bare "whisper" (caller handles ENOENT)
 */
export function resolveWhisperBinary(): string {
  const envPath =
    typeof Bun !== "undefined"
      ? Bun.env.SPACEDUCK_WHISPER_PATH
      : process.env.SPACEDUCK_WHISPER_PATH;
  if (envPath) return envPath;

  if (typeof Bun !== "undefined" && typeof Bun.which === "function") {
    const found = Bun.which("whisper");
    if (found) return found;
  }

  return "whisper";
}

function defaultRunner(
  args: string[],
  opts: { timeoutMs: number; cwd?: string },
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: opts.cwd,
    });

    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.stdout?.resume();

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, opts.timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").slice(-2000);
      if (killed) {
        reject(new SttError("TIMEOUT", `whisper timed out after ${opts.timeoutMs}ms`));
        return;
      }
      resolve({ exitCode: code ?? 1, stderr });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new SttError(
            "BINARY_NOT_FOUND",
            `whisper binary not found: ${args[0]}. Install with: pip install openai-whisper`,
          ),
        );
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Classify whisper stderr into a typed error code.
 * Conservative: fewer wrong codes beats more codes.
 */
function classifyStderr(stderr: string): SttErrorCode {
  if (/ffmpeg/i.test(stderr) && /(Invalid data|Failed to decode)/i.test(stderr)) {
    return "INVALID_AUDIO";
  }
  if (/(HTTP Error|Connection).{0,60}Downloading/is.test(stderr) ||
      /Downloading.{0,60}(HTTP Error|Connection)/is.test(stderr)) {
    return "MODEL_NOT_FOUND";
  }
  if (/(No such file or directory|not found)/i.test(stderr)) {
    return "BINARY_NOT_FOUND";
  }
  return "UNKNOWN";
}

/**
 * Find the Whisper JSON output file in the temp dir.
 * Strategy: basename match first, then glob for single .json file.
 */
function discoverJsonOutput(tmpDir: string, inputPath: string): string {
  const inputBase = parsePath(basename(inputPath)).name;
  const expectedFile = join(tmpDir, `${inputBase}.json`);

  if (existsSync(expectedFile)) return expectedFile;

  const entries = readdirSync(tmpDir);
  const jsonFiles = entries.filter((f) => f.endsWith(".json"));

  if (jsonFiles.length === 1) return join(tmpDir, jsonFiles[0]);

  if (jsonFiles.length === 0) {
    throw new SttError("PARSE_ERROR", `No JSON output file found in ${tmpDir}`);
  }
  throw new SttError(
    "PARSE_ERROR",
    `Expected 1 JSON output file, found ${jsonFiles.length}: ${jsonFiles.join(", ")}`,
  );
}

export class WhisperStt {
  private readonly runner: SubprocessRunner;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(opts?: { runner?: SubprocessRunner; model?: string; timeoutMs?: number }) {
    this.runner = opts?.runner ?? defaultRunner;
    this.model =
      opts?.model ??
      (typeof Bun !== "undefined"
        ? Bun.env.SPACEDUCK_STT_MODEL
        : process.env.SPACEDUCK_STT_MODEL) ??
      DEFAULT_MODEL;
    this.timeoutMs =
      opts?.timeoutMs ??
      Number(
        (typeof Bun !== "undefined"
          ? Bun.env.SPACEDUCK_STT_TIMEOUT_MS
          : process.env.SPACEDUCK_STT_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS,
      );
  }

  static async isAvailable(): Promise<AvailabilityResult> {
    const binary = resolveWhisperBinary();

    try {
      const result = await defaultRunner([binary, "--help"], {
        timeoutMs: HELP_TIMEOUT_MS,
      });
      if (result.exitCode === 0) {
        return { ok: true };
      }
      return {
        ok: false,
        reason: `whisper --help exited with code ${result.exitCode}. Install with: pip install openai-whisper`,
      };
    } catch (err) {
      if (err instanceof SttError && err.code === "BINARY_NOT_FOUND") {
        return {
          ok: false,
          reason: `whisper binary not found at "${binary}". Install with: pip install openai-whisper`,
        };
      }
      if (err instanceof SttError && err.code === "TIMEOUT") {
        return {
          ok: false,
          reason: "whisper --help timed out (possible broken Python environment)",
        };
      }
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async transcribeFile(
    localPath: string,
    opts?: TranscribeOptions,
  ): Promise<TranscribeResult> {
    const tmpDir = mkdtempSync(join(tmpdir(), "spaceduck-stt-"));
    const model = opts?.model ?? this.model;
    const timeout = opts?.timeoutMs ?? this.timeoutMs;

    try {
      const args = [
        resolveWhisperBinary(),
        localPath,
        "--task", "transcribe",
        "--model", model,
        "--output_format", "json",
        "--output_dir", tmpDir,
        "--fp16", "False",
        "--verbose", "False",
      ];

      if (opts?.languageHint) {
        args.push("--language", opts.languageHint);
      }

      let result: { exitCode: number; stderr: string };
      try {
        result = await this.runner(args, { timeoutMs: timeout });
      } catch (err) {
        if (err instanceof SttError) throw err;
        throw new SttError(
          "UNKNOWN",
          err instanceof Error ? err.message : String(err),
        );
      }

      if (result.exitCode !== 0) {
        const code = classifyStderr(result.stderr);
        throw new SttError(code, `whisper exited with code ${result.exitCode}`);
      }

      const jsonPath = discoverJsonOutput(tmpDir, localPath);
      const raw = readFileSync(jsonPath, "utf-8");

      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new SttError("PARSE_ERROR", "Failed to parse whisper JSON output");
      }

      const text: string = (parsed.text ?? "").trim();
      const language: string =
        parsed.language ?? opts?.languageHint ?? "und";

      const segments: TranscribeResult["segments"] = Array.isArray(parsed.segments)
        ? parsed.segments.map((s: any) => ({
            start: Number(s.start ?? 0),
            end: Number(s.end ?? 0),
            text: String(s.text ?? "").trim(),
          }))
        : undefined;

      return { text, language, segments };
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}
