import { describe, expect, test } from "bun:test";
import { SECRET_PATHS, isSecretPath, getSecretStatus } from "../secrets";
import { redactConfig } from "../redact";
import { defaultConfig } from "../defaults";
import { SpaceduckConfigSchema } from "../schema";

describe("SECRET_PATHS", () => {
  test("contains exactly the 7 known secret paths", () => {
    expect(SECRET_PATHS).toHaveLength(7);
    expect(SECRET_PATHS).toContain("/ai/secrets/geminiApiKey");
    expect(SECRET_PATHS).toContain("/ai/secrets/bedrockApiKey");
    expect(SECRET_PATHS).toContain("/ai/secrets/openrouterApiKey");
    expect(SECRET_PATHS).toContain("/ai/secrets/lmstudioApiKey");
    expect(SECRET_PATHS).toContain("/ai/secrets/llamacppApiKey");
    expect(SECRET_PATHS).toContain("/tools/webSearch/secrets/braveApiKey");
    expect(SECRET_PATHS).toContain("/tools/webAnswer/secrets/perplexityApiKey");
  });

  test("non-secret paths are NOT in SECRET_PATHS", () => {
    expect(SECRET_PATHS).not.toContain("/ai/region");
    expect(SECRET_PATHS).not.toContain("/tools/webSearch/searxngUrl");
    expect(SECRET_PATHS).not.toContain("/ai/model");
  });
});

describe("isSecretPath", () => {
  test("returns true for secret paths", () => {
    expect(isSecretPath("/ai/secrets/geminiApiKey")).toBe(true);
    expect(isSecretPath("/tools/webAnswer/secrets/perplexityApiKey")).toBe(true);
  });

  test("returns false for non-secret paths", () => {
    expect(isSecretPath("/ai/model")).toBe(false);
    expect(isSecretPath("/tools/webSearch/searxngUrl")).toBe(false);
    expect(isSecretPath("/ai/secrets")).toBe(false);
    expect(isSecretPath("")).toBe(false);
  });
});

describe("getSecretStatus", () => {
  test("all secrets unset on default config", () => {
    const config = defaultConfig();
    const status = getSecretStatus(config);
    expect(status).toHaveLength(7);
    for (const entry of status) {
      expect(entry.isSet).toBe(false);
    }
  });

  test("reports isSet=true when secret has a value", () => {
    const config = SpaceduckConfigSchema.parse({
      ai: { secrets: { geminiApiKey: "AIza-test-key" } },
      tools: { webSearch: { secrets: { braveApiKey: "BSA-test" } } },
    });
    const status = getSecretStatus(config);
    const gemini = status.find((s) => s.path === "/ai/secrets/geminiApiKey");
    const brave = status.find((s) => s.path === "/tools/webSearch/secrets/braveApiKey");
    const bedrock = status.find((s) => s.path === "/ai/secrets/bedrockApiKey");

    expect(gemini?.isSet).toBe(true);
    expect(brave?.isSet).toBe(true);
    expect(bedrock?.isSet).toBe(false);
  });
});

describe("redactConfig", () => {
  test("nulls all secret values", () => {
    const config = SpaceduckConfigSchema.parse({
      ai: { secrets: { geminiApiKey: "AIza-real-key", bedrockApiKey: "bedrock-key" } },
      tools: {
        webSearch: { secrets: { braveApiKey: "BSA-real" } },
        webAnswer: { secrets: { perplexityApiKey: "pplx-real" } },
      },
    });

    const redacted = redactConfig(config);

    expect(redacted.ai.secrets.geminiApiKey).toBeNull();
    expect(redacted.ai.secrets.bedrockApiKey).toBeNull();
    expect(redacted.ai.secrets.openrouterApiKey).toBeNull();
    expect(redacted.ai.secrets.lmstudioApiKey).toBeNull();
    expect(redacted.tools.webSearch.secrets.braveApiKey).toBeNull();
    expect(redacted.tools.webAnswer.secrets.perplexityApiKey).toBeNull();
  });

  test("preserves non-secret fields", () => {
    const config = SpaceduckConfigSchema.parse({
      ai: { provider: "bedrock", model: "claude-4", region: "us-east-1" },
      tools: { webSearch: { searxngUrl: "http://localhost:8080" } },
    });

    const redacted = redactConfig(config);

    expect(redacted.ai.provider).toBe("bedrock");
    expect(redacted.ai.model).toBe("claude-4");
    expect(redacted.ai.region).toBe("us-east-1");
    expect(redacted.tools.webSearch.searxngUrl).toBe("http://localhost:8080");
  });

  test("does not mutate original config", () => {
    const config = SpaceduckConfigSchema.parse({
      ai: { secrets: { geminiApiKey: "keep-me" } },
    });
    redactConfig(config);
    expect(config.ai.secrets.geminiApiKey).toBe("keep-me");
  });
});
