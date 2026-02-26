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
    expect(HOT_APPLY_PATHS.has("/onboarding/completed")).toBe(true);
    expect(HOT_APPLY_PATHS.has("/onboarding/mode")).toBe(true);
    expect(HOT_APPLY_PATHS.has("/onboarding/lastStep")).toBe(true);
    expect(HOT_APPLY_PATHS.has("/onboarding/completedAt")).toBe(true);
    expect(HOT_APPLY_PATHS.has("/onboarding/skippedAt")).toBe(true);
    expect(HOT_APPLY_PATHS.has("/onboarding/versionCompleted")).toBe(true);
    expect(HOT_APPLY_PATHS.has("/tools/browser/livePreview")).toBe(true);
    expect(HOT_APPLY_PATHS.has("/tools/browser/sessionIdleTimeoutMs")).toBe(true);
    expect(HOT_APPLY_PATHS.has("/tools/browser/maxSessions")).toBe(true);
  });

  test("does NOT contain restart-required paths", () => {
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
      { op: "replace", path: "/embedding/provider", value: "gemini" },
      { op: "replace", path: "/embedding/model", value: "text-embedding-004" },
    ];
    const result = classifyOps(ops);
    expect(result.hotApply).toEqual([]);
    expect(result.needsRestart).toEqual(["/embedding/provider", "/embedding/model"]);
  });

  test("handles mixed ops", () => {
    const ops: ConfigPatchOp[] = [
      { op: "replace", path: "/ai/temperature", value: 1.0 },
      { op: "replace", path: "/embedding/provider", value: "bedrock" },
      { op: "replace", path: "/gateway/name", value: "my-duck" },
    ];
    const result = classifyOps(ops);
    expect(result.hotApply).toEqual(["/ai/temperature", "/gateway/name"]);
    expect(result.needsRestart).toEqual(["/embedding/provider"]);
  });

  test("returns empty arrays for empty ops", () => {
    const result = classifyOps([]);
    expect(result.hotApply).toEqual([]);
    expect(result.needsRestart).toEqual([]);
  });
});
