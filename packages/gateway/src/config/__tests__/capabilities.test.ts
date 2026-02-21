import { describe, expect, test } from "bun:test";
import { getConfiguredStatus } from "../capabilities";
import { SpaceduckConfigSchema } from "@spaceduck/config";

describe("getConfiguredStatus", () => {
  test("lmstudio provider is ready without API key", () => {
    const config = SpaceduckConfigSchema.parse({
      ai: { provider: "lmstudio" },
    });
    const status = getConfiguredStatus(config);
    expect(status.aiProviderReady).toBe(true);
  });

  test("gemini provider needs geminiApiKey", () => {
    const config = SpaceduckConfigSchema.parse({
      ai: { provider: "gemini" },
    });
    expect(getConfiguredStatus(config).aiProviderReady).toBe(false);

    const withKey = SpaceduckConfigSchema.parse({
      ai: { provider: "gemini", secrets: { geminiApiKey: "AIza-test" } },
    });
    expect(getConfiguredStatus(withKey).aiProviderReady).toBe(true);
  });

  test("bedrock provider needs bedrockApiKey", () => {
    const config = SpaceduckConfigSchema.parse({
      ai: { provider: "bedrock", secrets: { bedrockApiKey: "key" } },
    });
    expect(getConfiguredStatus(config).aiProviderReady).toBe(true);

    const noKey = SpaceduckConfigSchema.parse({ ai: { provider: "bedrock" } });
    expect(getConfiguredStatus(noKey).aiProviderReady).toBe(false);
  });

  test("webSearchReady: true if braveApiKey set", () => {
    const config = SpaceduckConfigSchema.parse({
      tools: { webSearch: { secrets: { braveApiKey: "BSA-test" } } },
    });
    expect(getConfiguredStatus(config).webSearchReady).toBe(true);
  });

  test("webSearchReady: true if searxngUrl set", () => {
    const config = SpaceduckConfigSchema.parse({
      tools: { webSearch: { searxngUrl: "http://localhost:8080" } },
    });
    expect(getConfiguredStatus(config).webSearchReady).toBe(true);
  });

  test("webSearchReady: false if neither set", () => {
    const config = SpaceduckConfigSchema.parse({});
    expect(getConfiguredStatus(config).webSearchReady).toBe(false);
  });

  test("webAnswerReady: true if perplexityApiKey set", () => {
    const config = SpaceduckConfigSchema.parse({
      tools: { webAnswer: { secrets: { perplexityApiKey: "pplx-test" } } },
    });
    expect(getConfiguredStatus(config).webAnswerReady).toBe(true);
  });

  test("webAnswerReady: true if openrouterApiKey set", () => {
    const config = SpaceduckConfigSchema.parse({
      ai: { secrets: { openrouterApiKey: "sk-or-test" } },
    });
    expect(getConfiguredStatus(config).webAnswerReady).toBe(true);
  });

  test("webAnswerReady: false if neither set", () => {
    const config = SpaceduckConfigSchema.parse({});
    expect(getConfiguredStatus(config).webAnswerReady).toBe(false);
  });
});
