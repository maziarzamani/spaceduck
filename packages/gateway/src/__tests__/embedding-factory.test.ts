import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { createEmbeddingProvider } from "../embedding-factory";
import { ConsoleLogger, ConfigError } from "@spaceduck/core";

const logger = new ConsoleLogger("error");

const baseConfig = {
  provider: { name: "gemini" },
} as any;

describe("createEmbeddingProvider", () => {
  const originalEnv = { ...Bun.env };

  beforeEach(() => {
    delete Bun.env.EMBEDDING_ENABLED;
    delete Bun.env.EMBEDDING_PROVIDER;
    delete Bun.env.EMBEDDING_MODEL;
    delete Bun.env.EMBEDDING_DIMENSIONS;
    delete Bun.env.GEMINI_API_KEY;
    delete Bun.env.LMSTUDIO_BASE_URL;
    delete Bun.env.LMSTUDIO_API_KEY;
    delete Bun.env.LLAMACPP_BASE_URL;
    delete Bun.env.AWS_BEARER_TOKEN_BEDROCK;
    delete Bun.env.BEDROCK_API_KEY;
    delete Bun.env.AWS_REGION;
    delete Bun.env.EMBEDDING_INSTRUCTION;
  });

  afterEach(() => {
    Object.assign(Bun.env, originalEnv);
  });

  test("returns undefined when embeddings disabled via product config", () => {
    const result = createEmbeddingProvider(baseConfig, logger, {
      embedding: { enabled: false },
    } as any);
    expect(result).toBeUndefined();
  });

  test("returns undefined when embeddings disabled via env", () => {
    Bun.env.EMBEDDING_ENABLED = "false";
    const result = createEmbeddingProvider(baseConfig, logger);
    expect(result).toBeUndefined();
  });

  test("returns undefined for unknown provider", () => {
    Bun.env.EMBEDDING_PROVIDER = "nonexistent";
    const result = createEmbeddingProvider(baseConfig, logger);
    expect(result).toBeUndefined();
  });

  test("throws ConfigError for invalid dimensions", () => {
    Bun.env.EMBEDDING_PROVIDER = "lmstudio";
    Bun.env.EMBEDDING_DIMENSIONS = "-5";
    expect(() => createEmbeddingProvider(baseConfig, logger)).toThrow(ConfigError);
  });

  test("throws ConfigError for NaN dimensions", () => {
    Bun.env.EMBEDDING_PROVIDER = "lmstudio";
    Bun.env.EMBEDDING_DIMENSIONS = "abc";
    expect(() => createEmbeddingProvider(baseConfig, logger)).toThrow(ConfigError);
  });

  test("creates gemini embedding provider when API key available", () => {
    Bun.env.EMBEDDING_PROVIDER = "gemini";
    Bun.env.GEMINI_API_KEY = "test-gemini-key";
    const provider = createEmbeddingProvider(baseConfig, logger);
    expect(provider).toBeDefined();
    expect(provider!.name).toBe("gemini");
  });

  test("throws ConfigError when gemini API key is missing", () => {
    Bun.env.EMBEDDING_PROVIDER = "gemini";
    expect(() => createEmbeddingProvider(baseConfig, logger)).toThrow(ConfigError);
  });

  test("creates lmstudio embedding provider", () => {
    Bun.env.EMBEDDING_PROVIDER = "lmstudio";
    const provider = createEmbeddingProvider(baseConfig, logger);
    expect(provider).toBeDefined();
    expect(provider!.name).toContain("lmstudio");
  });

  test("creates llamacpp embedding provider", () => {
    Bun.env.EMBEDDING_PROVIDER = "llamacpp";
    const provider = createEmbeddingProvider(baseConfig, logger);
    expect(provider).toBeDefined();
  });

  test("creates bedrock embedding provider", () => {
    Bun.env.EMBEDDING_PROVIDER = "bedrock";
    Bun.env.AWS_BEARER_TOKEN_BEDROCK = "test-bedrock-key";
    const provider = createEmbeddingProvider(baseConfig, logger);
    expect(provider).toBeDefined();
    expect(provider!.name).toBe("bedrock");
  });

  test("throws ConfigError for invalid bedrock dimensions", () => {
    Bun.env.EMBEDDING_PROVIDER = "bedrock";
    Bun.env.EMBEDDING_DIMENSIONS = "999";
    Bun.env.AWS_BEARER_TOKEN_BEDROCK = "key";
    expect(() => createEmbeddingProvider(baseConfig, logger)).toThrow(ConfigError);
  });

  test("accepts valid bedrock Titan dimensions", () => {
    Bun.env.EMBEDDING_PROVIDER = "bedrock";
    Bun.env.EMBEDDING_DIMENSIONS = "512";
    Bun.env.AWS_BEARER_TOKEN_BEDROCK = "key";
    const provider = createEmbeddingProvider(baseConfig, logger);
    expect(provider).toBeDefined();
    expect(provider!.dimensions).toBe(512);
  });

  test("accepts valid bedrock Nova dimensions", () => {
    Bun.env.EMBEDDING_PROVIDER = "bedrock";
    Bun.env.EMBEDDING_MODEL = "amazon.nova-2-multimodal-embeddings-v1:0";
    Bun.env.EMBEDDING_DIMENSIONS = "384";
    Bun.env.AWS_BEARER_TOKEN_BEDROCK = "key";
    const provider = createEmbeddingProvider(baseConfig, logger);
    expect(provider).toBeDefined();
    expect(provider!.dimensions).toBe(384);
  });

  test("reads API key from product config secrets for gemini", () => {
    Bun.env.EMBEDDING_PROVIDER = "gemini";
    const provider = createEmbeddingProvider(baseConfig, logger, {
      ai: { secrets: { geminiApiKey: "config-key" } },
    } as any);
    expect(provider).toBeDefined();
    expect(provider!.name).toBe("gemini");
  });

  test("env EMBEDDING_PROVIDER takes precedence over product config", () => {
    Bun.env.EMBEDDING_PROVIDER = "lmstudio";
    const provider = createEmbeddingProvider(baseConfig, logger, {
      embedding: { provider: "gemini" },
      ai: { secrets: { geminiApiKey: "key" } },
    } as any);
    expect(provider).toBeDefined();
    expect(provider!.name).toContain("lmstudio");
  });
});
