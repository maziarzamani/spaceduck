// MarkerTool: spawns `marker_single` to convert PDFs to Markdown.
// Marker (GPL-3.0) is never bundled — users install it themselves.
// The tool is only registered at startup when `marker_single` is found on PATH.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface MarkerToolOptions {
  timeoutMs?: number;
  maxOutputChars?: number;
}

export interface MarkerConvertOptions {
  pageRange?: string;
  forceOcr?: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_CHARS = 100_000;

export class MarkerTool {
  private readonly timeoutMs: number;
  private readonly maxOutputChars: number;

  constructor(opts: MarkerToolOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputChars = opts.maxOutputChars ?? DEFAULT_MAX_CHARS;
  }

  /**
   * Check if `marker_single` is available on PATH.
   * Used at registration time to conditionally register the tool.
   */
  static async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["which", "marker_single"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      return code === 0;
    } catch {
      return false;
    }
  }

  /**
   * Convert a PDF to markdown by shelling out to marker_single.
   * Runs in a temporary directory and cleans up after itself.
   */
  async convert(localPath: string, opts?: MarkerConvertOptions): Promise<string> {
    const tmpDir = mkdtempSync(join(tmpdir(), "marker-"));

    try {
      const args = ["marker_single", localPath, "--output_dir", tmpDir, "--output_format", "markdown"];

      if (opts?.pageRange) {
        args.push("--page_range", opts.pageRange);
      }
      if (opts?.forceOcr) {
        args.push("--force_ocr");
      }

      const useLlm = (typeof Bun !== "undefined" ? Bun.env.MARKER_USE_LLM : process.env.MARKER_USE_LLM) === "true";
      if (useLlm) {
        args.push("--use_llm");
      }

      let exitCode: number;
      let stderr = "";
      try {
        const result = await this.runSubprocess(args);
        exitCode = result.exitCode;
        stderr = result.stderr;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: failed to run marker_single — ${msg}`;
      }

      if (exitCode !== 0) {
        return `Error: marker_single exited with code ${exitCode}\n${stderr}`.trim();
      }

      const mdContent = this.findAndReadMarkdown(tmpDir);
      if (!mdContent) {
        return "Error: marker_single produced no markdown output";
      }

      if (mdContent.length > this.maxOutputChars) {
        return (
          mdContent.slice(0, this.maxOutputChars) +
          `\n\n[Output truncated at ${this.maxOutputChars} characters]`
        );
      }

      return mdContent;
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }

  private runSubprocess(args: string[]): Promise<{ exitCode: number; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(args[0], args.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stderrChunks: Buffer[] = [];
      child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
      child.stdout?.resume();

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`marker_single timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? 1,
          stderr: Buffer.concat(stderrChunks).toString("utf-8").slice(-2000),
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private findAndReadMarkdown(dir: string): string | null {
    try {
      const entries = readdirSync(dir, { recursive: true, withFileTypes: false }) as string[];
      // marker_single puts output in a subdirectory
      const mdFiles = this.findMdFiles(dir);
      if (mdFiles.length === 0) return null;
      return readFileSync(mdFiles[0], "utf-8");
    } catch {
      return null;
    }
  }

  private findMdFiles(dir: string): string[] {
    const results: string[] = [];

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.findMdFiles(fullPath));
        } else if (entry.name.endsWith(".md")) {
          results.push(fullPath);
        }
      }
    } catch {
      // Skip unreadable directories
    }

    return results;
  }
}
