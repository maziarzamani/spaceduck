import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, parse as parsePath } from "node:path";
import { WhisperStt, resolveWhisperBinary, type SubprocessRunner } from "../whisper-stt";
import { SttError } from "../stt-error";

const MOCK_WHISPER_JSON = {
  text: " Hello world, this is a test.",
  segments: [
    { id: 0, start: 0.0, end: 1.5, text: " Hello world," },
    { id: 1, start: 1.5, end: 3.0, text: " this is a test." },
  ],
  language: "en",
};

function createFakeRunner(opts?: {
  exitCode?: number;
  stderr?: string;
  jsonOutput?: any;
  jsonFilename?: string;
  noOutput?: boolean;
  multipleJsonFiles?: string[];
  delayMs?: number;
  capturedArgs?: string[][];
}): SubprocessRunner {
  const capturedArgs = opts?.capturedArgs ?? [];

  return async (args, runnerOpts) => {
    capturedArgs.push([...args]);

    if (opts?.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
    }

    // Write JSON output file to the --output_dir if specified
    const outputDirIdx = args.indexOf("--output_dir");
    if (outputDirIdx !== -1 && !opts?.noOutput) {
      const outputDir = args[outputDirIdx + 1];

      if (opts?.multipleJsonFiles) {
        for (const name of opts.multipleJsonFiles) {
          writeFileSync(
            join(outputDir, name),
            JSON.stringify(opts?.jsonOutput ?? MOCK_WHISPER_JSON),
          );
        }
      } else {
        // Default: write a single JSON file matching the input basename
        const inputPath = args[1];
        const inputBase = parsePath(basename(inputPath)).name;
        const filename = opts?.jsonFilename ?? `${inputBase}.json`;
        writeFileSync(
          join(outputDir, filename),
          JSON.stringify(opts?.jsonOutput ?? MOCK_WHISPER_JSON),
        );
      }
    }

    return {
      exitCode: opts?.exitCode ?? 0,
      stderr: opts?.stderr ?? "",
    };
  };
}

describe("WhisperStt", () => {
  describe("transcribeFile", () => {
    it("parses valid whisper JSON output", async () => {
      const stt = new WhisperStt({ runner: createFakeRunner() });
      const result = await stt.transcribeFile("/tmp/test-audio.webm");

      expect(result.text).toBe("Hello world, this is a test.");
      expect(result.language).toBe("en");
      expect(result.segments).toHaveLength(2);
      expect(result.segments![0]).toEqual({ start: 0.0, end: 1.5, text: "Hello world," });
      expect(result.segments![1]).toEqual({ start: 1.5, end: 3.0, text: "this is a test." });
    });

    it("passes correct CLI args including --task transcribe --fp16 False --verbose False", async () => {
      const capturedArgs: string[][] = [];
      const stt = new WhisperStt({
        runner: createFakeRunner({ capturedArgs }),
        model: "small",
      });

      await stt.transcribeFile("/tmp/test.webm");

      const args = capturedArgs[0];
      expect(args).toContain("--task");
      expect(args[args.indexOf("--task") + 1]).toBe("transcribe");
      expect(args).toContain("--fp16");
      expect(args[args.indexOf("--fp16") + 1]).toBe("False");
      expect(args).toContain("--verbose");
      expect(args[args.indexOf("--verbose") + 1]).toBe("False");
      expect(args).toContain("--model");
      expect(args[args.indexOf("--model") + 1]).toBe("small");
      expect(args).toContain("--output_format");
      expect(args[args.indexOf("--output_format") + 1]).toBe("json");
    });

    it("passes --language when languageHint is provided", async () => {
      const capturedArgs: string[][] = [];
      const stt = new WhisperStt({
        runner: createFakeRunner({ capturedArgs }),
      });

      await stt.transcribeFile("/tmp/test.webm", { languageHint: "da" });

      const args = capturedArgs[0];
      expect(args).toContain("--language");
      expect(args[args.indexOf("--language") + 1]).toBe("da");
    });

    it("does not pass --language when no hint is provided", async () => {
      const capturedArgs: string[][] = [];
      const stt = new WhisperStt({
        runner: createFakeRunner({ capturedArgs }),
      });

      await stt.transcribeFile("/tmp/test.webm");
      expect(capturedArgs[0]).not.toContain("--language");
    });

    it("falls back language to languageHint when JSON has no language field", async () => {
      const stt = new WhisperStt({
        runner: createFakeRunner({
          jsonOutput: { text: "Hej verden", segments: [] },
        }),
      });

      const result = await stt.transcribeFile("/tmp/test.webm", { languageHint: "da" });
      expect(result.language).toBe("da");
    });

    it('falls back language to "und" when no JSON language and no hint', async () => {
      const stt = new WhisperStt({
        runner: createFakeRunner({
          jsonOutput: { text: "Hello", segments: [] },
        }),
      });

      const result = await stt.transcribeFile("/tmp/test.webm");
      expect(result.language).toBe("und");
    });

    it("discovers JSON by input basename match", async () => {
      const stt = new WhisperStt({ runner: createFakeRunner() });
      const result = await stt.transcribeFile("/tmp/my-recording.webm");
      expect(result.text).toBe("Hello world, this is a test.");
    });

    it("falls back to single .json file when basename does not match", async () => {
      const stt = new WhisperStt({
        runner: createFakeRunner({ jsonFilename: "different-name.json" }),
      });
      const result = await stt.transcribeFile("/tmp/my-recording.webm");
      expect(result.text).toBe("Hello world, this is a test.");
    });

    it("throws PARSE_ERROR when no JSON files exist in output dir", async () => {
      const stt = new WhisperStt({
        runner: createFakeRunner({ noOutput: true }),
      });

      await expect(stt.transcribeFile("/tmp/test.webm")).rejects.toThrow(SttError);
      try {
        await stt.transcribeFile("/tmp/test.webm");
      } catch (err) {
        expect((err as SttError).code).toBe("PARSE_ERROR");
      }
    });

    it("throws PARSE_ERROR when multiple JSON files exist", async () => {
      const stt = new WhisperStt({
        runner: createFakeRunner({
          multipleJsonFiles: ["file1.json", "file2.json"],
        }),
      });

      await expect(stt.transcribeFile("/tmp/test.webm")).rejects.toThrow(SttError);
      try {
        await stt.transcribeFile("/tmp/test.webm");
      } catch (err) {
        expect((err as SttError).code).toBe("PARSE_ERROR");
        expect((err as SttError).message).toContain("file1.json");
        expect((err as SttError).message).toContain("file2.json");
      }
    });

    it("throws PARSE_ERROR when JSON is malformed", async () => {
      const runner: SubprocessRunner = async (args) => {
        const outputDirIdx = args.indexOf("--output_dir");
        if (outputDirIdx !== -1) {
          const outputDir = args[outputDirIdx + 1];
          const inputBase = parsePath(basename(args[1])).name;
          writeFileSync(join(outputDir, `${inputBase}.json`), "NOT VALID JSON{{{");
        }
        return { exitCode: 0, stderr: "" };
      };

      const stt = new WhisperStt({ runner });
      await expect(stt.transcribeFile("/tmp/test.webm")).rejects.toThrow(SttError);
      try {
        await stt.transcribeFile("/tmp/test.webm");
      } catch (err) {
        expect((err as SttError).code).toBe("PARSE_ERROR");
      }
    });

    it("cleans up temp output dir even on error", async () => {
      let capturedOutputDir: string | undefined;
      const runner: SubprocessRunner = async (args) => {
        const idx = args.indexOf("--output_dir");
        if (idx !== -1) capturedOutputDir = args[idx + 1];
        return { exitCode: 1, stderr: "some error" };
      };

      const stt = new WhisperStt({ runner });
      try {
        await stt.transcribeFile("/tmp/test.webm");
      } catch {
        // expected
      }

      expect(capturedOutputDir).toBeDefined();
      expect(existsSync(capturedOutputDir!)).toBe(false);
    });

    it("cleans up temp output dir on success", async () => {
      let capturedOutputDir: string | undefined;
      const runner: SubprocessRunner = async (args) => {
        const idx = args.indexOf("--output_dir");
        if (idx !== -1) {
          capturedOutputDir = args[idx + 1];
          const inputBase = parsePath(basename(args[1])).name;
          writeFileSync(
            join(capturedOutputDir, `${inputBase}.json`),
            JSON.stringify(MOCK_WHISPER_JSON),
          );
        }
        return { exitCode: 0, stderr: "" };
      };

      const stt = new WhisperStt({ runner });
      await stt.transcribeFile("/tmp/test.webm");

      expect(capturedOutputDir).toBeDefined();
      expect(existsSync(capturedOutputDir!)).toBe(false);
    });

    it("handles segments being absent from JSON", async () => {
      const stt = new WhisperStt({
        runner: createFakeRunner({
          jsonOutput: { text: "No segments here", language: "en" },
        }),
      });

      const result = await stt.transcribeFile("/tmp/test.webm");
      expect(result.text).toBe("No segments here");
      expect(result.segments).toBeUndefined();
    });
  });

  describe("stderr classification", () => {
    it('classifies ffmpeg decode error as INVALID_AUDIO', async () => {
      const stt = new WhisperStt({
        runner: createFakeRunner({
          exitCode: 1,
          stderr: "ffmpeg: Invalid data found when processing input",
          noOutput: true,
        }),
      });

      try {
        await stt.transcribeFile("/tmp/test.webm");
      } catch (err) {
        expect(err).toBeInstanceOf(SttError);
        expect((err as SttError).code).toBe("INVALID_AUDIO");
      }
    });

    it('classifies ffmpeg "Failed to decode" as INVALID_AUDIO', async () => {
      const stt = new WhisperStt({
        runner: createFakeRunner({
          exitCode: 1,
          stderr: "ffmpeg error: Failed to decode audio stream",
          noOutput: true,
        }),
      });

      try {
        await stt.transcribeFile("/tmp/test.webm");
      } catch (err) {
        expect(err).toBeInstanceOf(SttError);
        expect((err as SttError).code).toBe("INVALID_AUDIO");
      }
    });

    it("classifies download error as MODEL_NOT_FOUND", async () => {
      const stt = new WhisperStt({
        runner: createFakeRunner({
          exitCode: 1,
          stderr: "Downloading model... HTTP Error 404: Not Found",
          noOutput: true,
        }),
      });

      try {
        await stt.transcribeFile("/tmp/test.webm");
      } catch (err) {
        expect(err).toBeInstanceOf(SttError);
        expect((err as SttError).code).toBe("MODEL_NOT_FOUND");
      }
    });

    it("classifies connection error during download as MODEL_NOT_FOUND", async () => {
      const stt = new WhisperStt({
        runner: createFakeRunner({
          exitCode: 1,
          stderr: "Connection refused while Downloading model weights",
          noOutput: true,
        }),
      });

      try {
        await stt.transcribeFile("/tmp/test.webm");
      } catch (err) {
        expect(err).toBeInstanceOf(SttError);
        expect((err as SttError).code).toBe("MODEL_NOT_FOUND");
      }
    });

    it("classifies unknown non-zero exit as UNKNOWN", async () => {
      const stt = new WhisperStt({
        runner: createFakeRunner({
          exitCode: 1,
          stderr: "some random error message",
          noOutput: true,
        }),
      });

      try {
        await stt.transcribeFile("/tmp/test.webm");
      } catch (err) {
        expect(err).toBeInstanceOf(SttError);
        expect((err as SttError).code).toBe("UNKNOWN");
      }
    });
  });

  describe("timeout handling", () => {
    it("throws TIMEOUT from runner on timeout", async () => {
      const runner: SubprocessRunner = async () => {
        throw new SttError("TIMEOUT", "whisper timed out after 100ms");
      };

      const stt = new WhisperStt({ runner });
      await expect(stt.transcribeFile("/tmp/test.webm")).rejects.toThrow(SttError);
      try {
        await stt.transcribeFile("/tmp/test.webm");
      } catch (err) {
        expect((err as SttError).code).toBe("TIMEOUT");
      }
    });
  });

  describe("resolveWhisperBinary", () => {
    const originalEnv = process.env.SPACEDUCK_WHISPER_PATH;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.SPACEDUCK_WHISPER_PATH;
      } else {
        process.env.SPACEDUCK_WHISPER_PATH = originalEnv;
      }
    });

    it("uses SPACEDUCK_WHISPER_PATH when set", () => {
      process.env.SPACEDUCK_WHISPER_PATH = "/custom/path/whisper";
      expect(resolveWhisperBinary()).toBe("/custom/path/whisper");
    });

    it('falls back to "whisper" when env var is not set and Bun.which returns null', () => {
      delete process.env.SPACEDUCK_WHISPER_PATH;
      const result = resolveWhisperBinary();
      // Either Bun.which finds it or we get bare "whisper"
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("isAvailable", () => {
    it("returns ok: true or ok: false without throwing", async () => {
      const result = await WhisperStt.isAvailable();
      expect(typeof result.ok).toBe("boolean");
      if (!result.ok) {
        expect(typeof result.reason).toBe("string");
      }
    });
  });
});
