import { describe, expect, test } from "bun:test";
import { SpaceduckConfigSchema, HttpUrlSchema, SttModelEnum } from "../schema";
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
    expect(config.onboarding.completed).toBe(false);
    expect(config.onboarding.version).toBe(1);
  });

  test("all secrets default to null", () => {
    const config = SpaceduckConfigSchema.parse({});
    expect(config.ai.secrets.geminiApiKey).toBeNull();
    expect(config.ai.secrets.bedrockApiKey).toBeNull();
    expect(config.ai.secrets.openrouterApiKey).toBeNull();
    expect(config.ai.secrets.lmstudioApiKey).toBeNull();
    expect((config.ai.secrets as any).llamacppApiKey).toBeNull();
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
      stt: { model: "medium", languageHint: "da" },
    });
    expect(config.ai.provider).toBe("bedrock");
    expect(config.ai.model).toBe("us.anthropic.claude-sonnet-4-20250514:0");
    expect(config.ai.region).toBe("us-east-1");
    expect(config.stt.model).toBe("medium");
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
    expect(config.onboarding).toBeDefined();
  });

  test("every nested object is fully materialized", () => {
    const config = defaultConfig();
    // Every object key should exist (no undefined values that would need `add` ops)
    expect(Object.keys(config.ai.secrets)).toHaveLength(5);
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

describe("OnboardingSchema", () => {
  test("defaults are all null/false", () => {
    const config = SpaceduckConfigSchema.parse({});
    expect(config.onboarding.completed).toBe(false);
    expect(config.onboarding.version).toBe(1);
    expect(config.onboarding.versionCompleted).toBeNull();
    expect(config.onboarding.mode).toBeNull();
    expect(config.onboarding.lastStep).toBeNull();
    expect(config.onboarding.completedAt).toBeNull();
    expect(config.onboarding.skippedAt).toBeNull();
  });

  test("accepts valid mode values", () => {
    for (const mode of ["local", "cloud", "advanced"] as const) {
      const config = SpaceduckConfigSchema.parse({ onboarding: { mode } });
      expect(config.onboarding.mode).toBe(mode);
    }
  });

  test("rejects invalid mode", () => {
    expect(() =>
      SpaceduckConfigSchema.parse({ onboarding: { mode: "unknown" } }),
    ).toThrow();
  });

  test("accepts partial overrides", () => {
    const config = SpaceduckConfigSchema.parse({
      onboarding: {
        completed: true,
        mode: "cloud",
        lastStep: "summary",
        completedAt: "2026-01-01T00:00:00.000Z",
        versionCompleted: 1,
      },
    });
    expect(config.onboarding.completed).toBe(true);
    expect(config.onboarding.mode).toBe("cloud");
    expect(config.onboarding.lastStep).toBe("summary");
    expect(config.onboarding.completedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(config.onboarding.versionCompleted).toBe(1);
    expect(config.onboarding.skippedAt).toBeNull();
  });
});

describe("HttpUrlSchema", () => {
  const schema = HttpUrlSchema.nullable();

  test("accepts http://localhost:8080", () => {
    expect(schema.parse("http://localhost:8080")).toBe("http://localhost:8080");
  });

  test("accepts https://example.com", () => {
    expect(schema.parse("https://example.com")).toBe("https://example.com");
  });

  test("accepts http://searxng:8080 (Docker service name)", () => {
    expect(schema.parse("http://searxng:8080")).toBe("http://searxng:8080");
  });

  test("accepts http://127.0.0.1:8080/v1 (IP with path)", () => {
    expect(schema.parse("http://127.0.0.1:8080/v1")).toBe("http://127.0.0.1:8080/v1");
  });

  test("accepts null (nullable wrapper)", () => {
    expect(schema.parse(null)).toBeNull();
  });

  test("rejects plain string", () => {
    expect(() => schema.parse("not-a-url")).toThrow();
  });

  test("rejects ftp:// protocol", () => {
    expect(() => schema.parse("ftp://example.com")).toThrow();
  });

  test("rejects empty string", () => {
    expect(() => schema.parse("")).toThrow();
  });

  test("rejects string with only whitespace (no trim in schema)", () => {
    expect(() => schema.parse("  ")).toThrow();
  });

  test("accepts untrimmed URL (new URL() is whitespace-tolerant)", () => {
    expect(schema.parse("  http://localhost:8080  ")).toBe("  http://localhost:8080  ");
  });

  test("works through full config parse for searxngUrl", () => {
    const config = SpaceduckConfigSchema.parse({
      tools: { webSearch: { searxngUrl: "http://localhost:8080" } },
    });
    expect(config.tools.webSearch.searxngUrl).toBe("http://localhost:8080");
  });

  test("rejects invalid searxngUrl through full config parse", () => {
    expect(() =>
      SpaceduckConfigSchema.parse({
        tools: { webSearch: { searxngUrl: "nope" } },
      }),
    ).toThrow();
  });

  test("works through full config parse for ai.baseUrl", () => {
    const config = SpaceduckConfigSchema.parse({
      ai: { baseUrl: "http://localhost:1234/v1" },
    });
    expect(config.ai.baseUrl).toBe("http://localhost:1234/v1");
  });

  test("rejects invalid ai.baseUrl through full config parse", () => {
    expect(() =>
      SpaceduckConfigSchema.parse({
        ai: { baseUrl: "not-valid" },
      }),
    ).toThrow();
  });

  test("works through full config parse for embedding.baseUrl", () => {
    const config = SpaceduckConfigSchema.parse({
      embedding: { baseUrl: "http://localhost:1234/v1" },
    });
    expect(config.embedding.baseUrl).toBe("http://localhost:1234/v1");
  });
});

describe("SttModelEnum", () => {
  test("accepts all valid Whisper model sizes", () => {
    for (const size of ["tiny", "base", "small", "medium", "large"] as const) {
      expect(SttModelEnum.parse(size)).toBe(size);
    }
  });

  test("rejects invalid model names", () => {
    expect(() => SttModelEnum.parse("huge")).toThrow();
    expect(() => SttModelEnum.parse("turbo")).toThrow();
    expect(() => SttModelEnum.parse("")).toThrow();
  });

  test("default is 'small' through full config parse", () => {
    const config = SpaceduckConfigSchema.parse({});
    expect(config.stt.model).toBe("small");
  });

  test("rejects invalid model through full config parse", () => {
    expect(() =>
      SpaceduckConfigSchema.parse({ stt: { model: "xlarge" } }),
    ).toThrow();
  });
});
