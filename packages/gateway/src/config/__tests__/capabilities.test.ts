import { describe, expect, test, beforeEach } from "bun:test";
import { getConfiguredStatus, getSystemProfile, _resetSystemProfileCache } from "../capabilities";
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

describe("getSystemProfile", () => {
  beforeEach(() => {
    _resetSystemProfileCache();
  });

  test("returns all expected fields", () => {
    const profile = getSystemProfile();
    expect(profile).toHaveProperty("os");
    expect(profile).toHaveProperty("arch");
    expect(profile).toHaveProperty("appleSilicon");
    expect(profile).toHaveProperty("totalMemoryGB");
    expect(profile).toHaveProperty("cpuCores");
    expect(profile).toHaveProperty("confidence");
    expect(profile).toHaveProperty("recommendedTier");
    expect(profile).toHaveProperty("recommendations");
  });

  test("confidence is one of high/partial/unknown", () => {
    const profile = getSystemProfile();
    expect(["high", "partial", "unknown"]).toContain(profile.confidence);
  });

  test("recommendedTier is one of small/medium/large", () => {
    const profile = getSystemProfile();
    expect(["small", "medium", "large"]).toContain(profile.recommendedTier);
  });

  test("recommendations covers all tiers", () => {
    const profile = getSystemProfile();
    expect(profile.recommendations.small).toBeDefined();
    expect(profile.recommendations.medium).toBeDefined();
    expect(profile.recommendations.large).toBeDefined();
  });

  test("os is a string on a real machine", () => {
    const profile = getSystemProfile();
    expect(typeof profile.os).toBe("string");
    expect(profile.os!.length).toBeGreaterThan(0);
  });

  test("totalMemoryGB is a positive number on a real machine", () => {
    const profile = getSystemProfile();
    expect(profile.totalMemoryGB).toBeGreaterThan(0);
  });

  test("result is cached on subsequent calls", () => {
    const p1 = getSystemProfile();
    const p2 = getSystemProfile();
    expect(p1).toBe(p2);
  });

  test("cache resets with _resetSystemProfileCache", () => {
    const p1 = getSystemProfile();
    _resetSystemProfileCache();
    const p2 = getSystemProfile();
    expect(p1).not.toBe(p2);
    expect(p1).toEqual(p2);
  });
});
