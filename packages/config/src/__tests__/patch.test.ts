import { describe, expect, test } from "bun:test";
import { applyPatch, PatchError } from "../patch";
import { defaultConfig } from "../defaults";
import { SpaceduckConfigSchema } from "../schema";
import type { ConfigPatchOp } from "../types";

describe("applyPatch", () => {
  // ── replace ───────────────────────────────────────────────────

  test("replace: changes existing value", () => {
    const config = defaultConfig();
    const result = applyPatch(config, [
      { op: "replace", path: "/ai/model", value: "gemini-2.5-pro" },
    ]);
    expect(result.ai.model).toBe("gemini-2.5-pro");
  });

  test("replace: changes nested value", () => {
    const config = defaultConfig();
    const result = applyPatch(config, [
      { op: "replace", path: "/ai/temperature", value: 1.5 },
    ]);
    expect(result.ai.temperature).toBe(1.5);
  });

  test("replace: does not mutate original", () => {
    const config = defaultConfig();
    applyPatch(config, [
      { op: "replace", path: "/ai/model", value: "changed" },
    ]);
    expect(config.ai.model).toBe("gemini-2.5-flash");
  });

  test("replace: fails on non-existent path", () => {
    const config = defaultConfig();
    expect(() =>
      applyPatch(config, [
        { op: "replace", path: "/ai/nonExistent", value: "x" },
      ]),
    ).toThrow(PatchError);
  });

  test("replace: fails on non-existent nested path", () => {
    const config = defaultConfig();
    expect(() =>
      applyPatch(config, [
        { op: "replace", path: "/fake/deep/path", value: "x" },
      ]),
    ).toThrow(PatchError);
  });

  test("replace: multiple ops applied in order", () => {
    const config = defaultConfig();
    const result = applyPatch(config, [
      { op: "replace", path: "/ai/provider", value: "bedrock" },
      { op: "replace", path: "/ai/model", value: "claude-4" },
      { op: "replace", path: "/ai/region", value: "us-west-2" },
    ]);
    expect(result.ai.provider).toBe("bedrock");
    expect(result.ai.model).toBe("claude-4");
    expect(result.ai.region).toBe("us-west-2");
  });

  // ── add ────────────────────────────────────────────────────────

  test("add: sets a known schema key", () => {
    const config = defaultConfig();
    const result = applyPatch(config, [
      { op: "add", path: "/ai/systemPrompt", value: "Be concise" },
    ]);
    expect(result.ai.systemPrompt).toBe("Be concise");
  });

  test("add: rejects unknown key", () => {
    const config = defaultConfig();
    expect(() =>
      applyPatch(config, [
        { op: "add", path: "/ai/madeUpField", value: "oops" },
      ]),
    ).toThrow(PatchError);
  });

  test("add: rejects when parent does not exist", () => {
    const config = defaultConfig();
    expect(() =>
      applyPatch(config, [
        { op: "add", path: "/nonExistent/field", value: "x" },
      ]),
    ).toThrow(PatchError);
  });

  // ── secret path rejection ──────────────────────────────────────

  test("rejects ops on secret paths", () => {
    const config = defaultConfig();
    expect(() =>
      applyPatch(config, [
        { op: "replace", path: "/ai/secrets/geminiApiKey", value: "leaked" },
      ]),
    ).toThrow(/secret path/i);
  });

  test("rejects add on secret paths", () => {
    const config = defaultConfig();
    expect(() =>
      applyPatch(config, [
        { op: "add", path: "/tools/webSearch/secrets/braveApiKey", value: "x" },
      ]),
    ).toThrow(/secret path/i);
  });

  // ── pointer validation ─────────────────────────────────────────

  test("rejects invalid pointer (no leading slash)", () => {
    const config = defaultConfig();
    expect(() =>
      applyPatch(config, [
        { op: "replace", path: "ai/model", value: "x" },
      ]),
    ).toThrow(PatchError);
  });

  test("rejects empty ops array", () => {
    const config = defaultConfig();
    expect(() => applyPatch(config, [])).toThrow(PatchError);
  });

  // ── unsupported op ─────────────────────────────────────────────

  test("rejects remove op", () => {
    const config = defaultConfig();
    expect(() =>
      applyPatch(config, [
        { op: "remove" as "replace", path: "/ai/systemPrompt", value: undefined },
      ]),
    ).toThrow(/unsupported op/i);
  });

  // ── URL validation through patch pipeline ─────────────────────

  test("replace: invalid URL is structurally accepted by applyPatch but rejected by safeParse", () => {
    const config = defaultConfig();
    const patched = applyPatch(config, [
      { op: "replace", path: "/tools/webSearch/searxngUrl", value: "nope" },
    ]);
    expect(patched.tools.webSearch.searxngUrl).toBe("nope");

    const result = SpaceduckConfigSchema.safeParse(patched);
    expect(result.success).toBe(false);
  });

  test("replace: valid URL passes both applyPatch and safeParse", () => {
    const config = defaultConfig();
    const patched = applyPatch(config, [
      { op: "replace", path: "/tools/webSearch/searxngUrl", value: "http://localhost:8080" },
    ]);

    const result = SpaceduckConfigSchema.safeParse(patched);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tools.webSearch.searxngUrl).toBe("http://localhost:8080");
  });
});
