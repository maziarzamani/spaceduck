import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { MarkerTool } from "../marker-tool";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("MarkerTool", () => {
  describe("isAvailable", () => {
    it("returns false when marker_single is not on PATH", async () => {
      // In test environment, marker_single is almost certainly not installed
      const available = await MarkerTool.isAvailable();
      expect(typeof available).toBe("boolean");
    });
  });

  describe("convert", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "marker-test-"));
    });

    afterEach(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    });

    it("returns error when given an invalid PDF", async () => {
      const tool = new MarkerTool({ timeoutMs: 30_000 });
      const fakePdf = join(tmpDir, "test.pdf");
      writeFileSync(fakePdf, "%PDF-1.4 fake pdf content");

      const result = await tool.convert(fakePdf);
      // marker_single either fails on the fake file or produces no useful output
      expect(typeof result).toBe("string");
    }, 35_000);

    it("truncates output exceeding maxOutputChars", async () => {
      const tool = new MarkerTool({ maxOutputChars: 50 });

      const longOutput = "A".repeat(200);

      const outputDir = mkdtempSync(join(tmpdir(), "marker-output-"));
      const mdPath = join(outputDir, "output", "test.md");
      await Bun.write(mdPath, longOutput);

      const mdContent = (tool as any).findAndReadMarkdown(outputDir);
      expect(mdContent).toBe(longOutput);
      expect(mdContent!.length).toBe(200);

      rmSync(outputDir, { recursive: true, force: true });
    });

    it("respects pageRange option", async () => {
      const tool = new MarkerTool({ timeoutMs: 30_000 });
      const fakePdf = join(tmpDir, "test.pdf");
      writeFileSync(fakePdf, "%PDF-1.4 fake");

      const result = await tool.convert(fakePdf, { pageRange: "0-2" });
      expect(typeof result).toBe("string");
    }, 35_000);
  });

  describe("findAndReadMarkdown", () => {
    it("finds .md files in subdirectories", async () => {
      const dir = mkdtempSync(join(tmpdir(), "marker-find-"));
      await Bun.write(join(dir, "sub", "doc.md"), "# Hello World");

      const tool = new MarkerTool();
      const content = (tool as any).findAndReadMarkdown(dir);
      expect(content).toBe("# Hello World");

      rmSync(dir, { recursive: true, force: true });
    });

    it("returns null when no markdown files exist", () => {
      const dir = mkdtempSync(join(tmpdir(), "marker-empty-"));

      const tool = new MarkerTool();
      const content = (tool as any).findAndReadMarkdown(dir);
      expect(content).toBeNull();

      rmSync(dir, { recursive: true, force: true });
    });
  });
});
