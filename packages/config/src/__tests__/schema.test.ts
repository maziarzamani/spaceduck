import { describe, expect, test } from "bun:test";
import { SpaceduckConfigSchema } from "../schema";
import { defaultConfig } from "../defaults";
import type { ConfigPatchOp } from "../types";

describe("SpaceduckConfigSchema", () => {
  test("parses empty object to full defaults", () => {
    const config = SpaceduckConfigSchema.parse({});
    expect(config.version).toBe(1);
    expect(config.ai.provider).toBe("gemini");
    expect(config.ai.model).toBe("gemini-2.5-flash");
    expect(config.ai.temperature).toBe(0.7);
    expect(config.memory.enabled).toBe(true);
    expect(config.embedding.enabled).toBe(true);
    expect(config.stt.enabled).toBe(true);
    expect(config.stt.model).toBe("small");
    expect(config.tools.marker.enabled).toBe(true);
    expect(config.tools.webAnswer.enabled).toBe(true);
    expect(config.channels.whatsapp.enabled).toBe(false);
  });

  test("all secrets default to null", () => {
    const config = SpaceduckConfigSchema.parse({});
    expect(config.ai.secrets.geminiApiKey).toBeNull();
    expect(config.ai.secrets.bedrockApiKey).toBeNull();
    expect(config.ai.secrets.openrouterApiKey).toBeNull();
    expect(config.ai.secrets.lmstudioApiKey).toBeNull();
    expect(config.tools.webSearch.secrets.braveApiKey).toBeNull();
    expect(config.tools.webAnswer.secrets.perplexityApiKey).toBeNull();
  });

  test("searxngUrl is nullable non-secret field", () => {
    const config = SpaceduckConfigSchema.parse({});
    expect(config.tools.webSearch.searxngUrl).toBeNull();

    const withUrl = SpaceduckConfigSchema.parse({
      tools: { webSearch: { searxngUrl: "http://localhost:8080" } },
    });
    expect(withUrl.tools.webSearch.searxngUrl).toBe("http://localhost:8080");
  });

  test("accepts partial overrides", () => {
    const config = SpaceduckConfigSchema.parse({
      ai: { provider: "bedrock", model: "us.anthropic.claude-sonnet-4-20250514:0", region: "us-east-1" },
      stt: { model: "turbo", languageHint: "da" },
    });
    expect(config.ai.provider).toBe("bedrock");
    expect(config.ai.model).toBe("us.anthropic.claude-sonnet-4-20250514:0");
    expect(config.ai.region).toBe("us-east-1");
    expect(config.stt.model).toBe("turbo");
    expect(config.stt.languageHint).toBe("da");
    // Other fields still have defaults
    expect(config.ai.temperature).toBe(0.7);
    expect(config.memory.enabled).toBe(true);
  });

  test("rejects invalid provider", () => {
    expect(() =>
      SpaceduckConfigSchema.parse({ ai: { provider: "gpt4" } }),
    ).toThrow();
  });

  test("rejects temperature out of range", () => {
    expect(() =>
      SpaceduckConfigSchema.parse({ ai: { temperature: 3 } }),
    ).toThrow();
    expect(() =>
      SpaceduckConfigSchema.parse({ ai: { temperature: -1 } }),
    ).toThrow();
  });

  test("rejects wrong version", () => {
    expect(() =>
      SpaceduckConfigSchema.parse({ version: 2 }),
    ).toThrow();
  });
});

describe("defaultConfig", () => {
  test("returns all required fields", () => {
    const config = defaultConfig();
    expect(config.version).toBe(1);
    expect(config.gateway.name).toBeTypeOf("string");
    expect(config.gateway.name.length).toBeGreaterThan(0);
    expect(config.ai).toBeDefined();
    expect(config.memory).toBeDefined();
    expect(config.embedding).toBeDefined();
    expect(config.stt).toBeDefined();
    expect(config.tools).toBeDefined();
    expect(config.channels).toBeDefined();
  });

  test("every nested object is fully materialized", () => {
    const config = defaultConfig();
    // Every object key should exist (no undefined values that would need `add` ops)
    expect(Object.keys(config.ai.secrets)).toHaveLength(4);
    expect(Object.keys(config.tools.webSearch.secrets)).toHaveLength(1);
    expect(Object.keys(config.tools.webAnswer.secrets)).toHaveLength(1);
  });
});

describe("ConfigPatchOp type", () => {
  test("allows replace and add ops", () => {
    const replace: ConfigPatchOp = { op: "replace", path: "/ai/model", value: "gemini-2.5-pro" };
    const add: ConfigPatchOp = { op: "add", path: "/ai/systemPrompt", value: "Hello" };
    expect(replace.op).toBe("replace");
    expect(add.op).toBe("add");
  });
});
