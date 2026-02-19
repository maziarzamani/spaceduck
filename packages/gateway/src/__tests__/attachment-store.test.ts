import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { AttachmentStore } from "../attachment-store";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("AttachmentStore", () => {
  let uploadDir: string;
  let store: AttachmentStore;

  beforeEach(() => {
    uploadDir = mkdtempSync(join(tmpdir(), "att-test-"));
    store = new AttachmentStore({ uploadDir, ttlMs: 500 });
  });

  afterEach(() => {
    store.stop();
    try {
      rmSync(uploadDir, { recursive: true, force: true });
    } catch {}
  });

  it("registers and resolves an attachment", () => {
    const filePath = join(uploadDir, "test.pdf");
    writeFileSync(filePath, "fake");

    store.register("att-1", {
      localPath: filePath,
      filename: "test.pdf",
      mimeType: "application/pdf",
      size: 4,
    });

    expect(store.resolve("att-1")).toBe(filePath);
  });

  it("returns null for unknown attachment IDs", () => {
    expect(store.resolve("unknown")).toBeNull();
  });

  it("returns null and removes expired attachments", async () => {
    const filePath = join(uploadDir, "expire.pdf");
    writeFileSync(filePath, "data");

    store.register("att-exp", {
      localPath: filePath,
      filename: "expire.pdf",
      mimeType: "application/pdf",
      size: 4,
    });

    // Wait for TTL to expire (500ms + buffer)
    await new Promise((r) => setTimeout(r, 600));

    expect(store.resolve("att-exp")).toBeNull();
    expect(existsSync(filePath)).toBe(false);
  });

  it("get() returns full entry metadata", () => {
    const filePath = join(uploadDir, "meta.pdf");
    writeFileSync(filePath, "meta");

    store.register("att-meta", {
      localPath: filePath,
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: 4,
    });

    const entry = store.get("att-meta");
    expect(entry).not.toBeNull();
    expect(entry!.filename).toBe("report.pdf");
    expect(entry!.mimeType).toBe("application/pdf");
    expect(entry!.size).toBe(4);
  });
});
