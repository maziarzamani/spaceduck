import { describe, expect, test } from "bun:test";
import { HOT_APPLY_PATHS, classifyOps } from "../hot-apply";
import type { ConfigPatchOp } from "../types";

describe("HOT_APPLY_PATHS", () => {
  test("contains expected hot-apply paths", () => {
    expect(HOT_APPLY_PATHS.has("/ai/temperature")).toBe(true);
    expect(HOT_APPLY_PATHS.has("/ai/systemPrompt")).toBe(true);
    expect(HOT_APPLY_PATHS.has("/gateway/name")).toBe(true);
    expect(HOT_APPLY_PATHS.has("/stt/languageHint")).toBe(true);
    expect(HOT_APPLY_PATHS.has("/tools/marker/enabled")).toBe(true);
  });

  test("does NOT contain restart-required paths", () => {
    expect(HOT_APPLY_PATHS.has("/ai/provider")).toBe(false);
    expect(HOT_APPLY_PATHS.has("/ai/model")).toBe(false);
    expect(HOT_APPLY_PATHS.has("/embedding/provider")).toBe(false);
    expect(HOT_APPLY_PATHS.has("/embedding/enabled")).toBe(false);
    expect(HOT_APPLY_PATHS.has("/memory/enabled")).toBe(false);
  });
});

describe("classifyOps", () => {
  test("classifies hot-apply ops correctly", () => {
    const ops: ConfigPatchOp[] = [
      { op: "replace", path: "/ai/temperature", value: 0.9 },
      { op: "replace", path: "/ai/systemPrompt", value: "Be helpful" },
    ];
    const result = classifyOps(ops);
    expect(result.hotApply).toEqual(["/ai/temperature", "/ai/systemPrompt"]);
    expect(result.needsRestart).toEqual([]);
  });

  test("classifies restart-required ops correctly", () => {
    const ops: ConfigPatchOp[] = [
      { op: "replace", path: "/ai/provider", value: "bedrock" },
      { op: "replace", path: "/ai/model", value: "claude-4" },
    ];
    const result = classifyOps(ops);
    expect(result.hotApply).toEqual([]);
    expect(result.needsRestart).toEqual(["/ai/provider", "/ai/model"]);
  });

  test("handles mixed ops", () => {
    const ops: ConfigPatchOp[] = [
      { op: "replace", path: "/ai/temperature", value: 1.0 },
      { op: "replace", path: "/ai/provider", value: "openrouter" },
      { op: "replace", path: "/gateway/name", value: "my-duck" },
    ];
    const result = classifyOps(ops);
    expect(result.hotApply).toEqual(["/ai/temperature", "/gateway/name"]);
    expect(result.needsRestart).toEqual(["/ai/provider"]);
  });

  test("returns empty arrays for empty ops", () => {
    const result = classifyOps([]);
    expect(result.hotApply).toEqual([]);
    expect(result.needsRestart).toEqual([]);
  });
});
