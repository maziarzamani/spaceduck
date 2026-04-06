import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverPlugins } from "../discover";

describe("discoverPlugins", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sd-discover-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("discovers packages with package.json", async () => {
    const toolDir = join(tempDir, "my-tool");
    await mkdir(toolDir, { recursive: true });
    await writeFile(
      join(toolDir, "package.json"),
      JSON.stringify({ name: "@spaceduck/tool-my-tool", main: "src/index.ts" }),
    );

    const result = await discoverPlugins(tempDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].dirName).toBe("my-tool");
    expect(result.value[0].modulePath).toContain("my-tool/src/index.ts");
  });

  it("skips directories without package.json", async () => {
    await mkdir(join(tempDir, "no-pkg"), { recursive: true });

    const result = await discoverPlugins(tempDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("defaults main to src/index.ts when missing", async () => {
    const toolDir = join(tempDir, "bare-tool");
    await mkdir(toolDir, { recursive: true });
    await writeFile(
      join(toolDir, "package.json"),
      JSON.stringify({ name: "bare" }),
    );

    const result = await discoverPlugins(tempDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0].modulePath).toContain("bare-tool/src/index.ts");
  });

  it("returns error for nonexistent directory", async () => {
    const result = await discoverPlugins("/nonexistent/path");
    expect(result.ok).toBe(false);
  });

  it("returns empty array for empty directory", async () => {
    const result = await discoverPlugins(tempDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("skips files (non-directories)", async () => {
    await writeFile(join(tempDir, "not-a-dir.txt"), "hello");

    const result = await discoverPlugins(tempDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });
});
