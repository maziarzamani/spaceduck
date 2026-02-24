import { describe, test, expect } from "bun:test";
import { redactConfig } from "../redact";
import { defaultConfig } from "../defaults";
import { SECRET_PATHS } from "../secrets";

describe("redactConfig", () => {
  test("returns a deep clone — does not mutate the original", () => {
    const original = defaultConfig();
    (original as any).ai.secrets = { geminiApiKey: "sk-real-key" };

    const redacted = redactConfig(original);

    expect(redacted).not.toBe(original);
    expect((original as any).ai.secrets.geminiApiKey).toBe("sk-real-key");
  });

  test("nullifies values at all SECRET_PATHS when they exist", () => {
    const config = defaultConfig() as Record<string, unknown>;

    // Manually populate all secret paths
    const ai = config.ai as Record<string, unknown>;
    if (!ai.secrets) ai.secrets = {};
    const secrets = ai.secrets as Record<string, unknown>;
    secrets.geminiApiKey = "key1";
    secrets.bedrockApiKey = "key2";
    secrets.openrouterApiKey = "key3";
    secrets.lmstudioApiKey = "key4";
    secrets.llamacppApiKey = "key5";

    const tools = config.tools as Record<string, unknown>;
    if (!tools.webSearch) tools.webSearch = {};
    if (!(tools.webSearch as any).secrets) (tools.webSearch as any).secrets = {};
    (tools.webSearch as any).secrets.braveApiKey = "brave-key";

    if (!tools.webAnswer) tools.webAnswer = {};
    if (!(tools.webAnswer as any).secrets) (tools.webAnswer as any).secrets = {};
    (tools.webAnswer as any).secrets.perplexityApiKey = "pplx-key";

    const redacted = redactConfig(config as any);

    // All secret paths should be null in the redacted copy
    for (const path of SECRET_PATHS) {
      const segments = path.slice(1).split("/");
      let current: unknown = redacted;
      for (const seg of segments) {
        current = (current as Record<string, unknown>)?.[seg];
      }
      expect(current).toBeNull();
    }
  });

  test("leaves non-secret values untouched", () => {
    const config = defaultConfig();
    (config as any).ai.provider = "gemini";
    (config as any).ai.model = "gemini-2.5-flash";

    const redacted = redactConfig(config);

    expect((redacted as any).ai.provider).toBe("gemini");
    expect((redacted as any).ai.model).toBe("gemini-2.5-flash");
  });

  test("handles missing intermediate segments gracefully", () => {
    const config = defaultConfig();
    // tools.webSearch might not have a secrets sub-object — setNestedValue should not throw
    delete (config as any).tools?.webSearch?.secrets;

    expect(() => redactConfig(config)).not.toThrow();
  });

  test("handles completely empty config sub-trees", () => {
    const config = { ai: {}, tools: {} } as any;
    expect(() => redactConfig(config)).not.toThrow();
  });
});
