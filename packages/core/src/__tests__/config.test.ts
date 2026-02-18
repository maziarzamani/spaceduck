import { describe, it, expect } from "bun:test";
import { loadConfig } from "../config";

describe("loadConfig", () => {
  it("should return valid config with Gemini defaults", () => {
    const original = { ...Bun.env };
    Bun.env.GEMINI_API_KEY = "test-key-123";
    Bun.env.PORT = "4000";
    Bun.env.LOG_LEVEL = "debug";
    delete Bun.env.PROVIDER_NAME;
    delete Bun.env.PROVIDER_MODEL;

    const result = loadConfig();
    Object.assign(Bun.env, original);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.port).toBe(4000);
      expect(result.value.logLevel).toBe("debug");
      expect(result.value.provider.name).toBe("gemini");
      expect(result.value.provider.model).toBe("gemini-2.5-flash");
    }
  });

  it("should use defaults when optional env vars are missing", () => {
    const original = { ...Bun.env };
    Bun.env.GEMINI_API_KEY = "test-key";
    delete Bun.env.PORT;
    delete Bun.env.LOG_LEVEL;
    delete Bun.env.PROVIDER_NAME;

    const result = loadConfig();
    Object.assign(Bun.env, original);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.port).toBe(3000);
      expect(result.value.logLevel).toBe("info");
    }
  });

  it("should fail on invalid port", () => {
    const original = { ...Bun.env };
    Bun.env.GEMINI_API_KEY = "test-key";
    Bun.env.PORT = "not-a-number";

    const result = loadConfig();
    Object.assign(Bun.env, original);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CONFIG_ERROR");
      expect(result.error.message).toContain("Invalid PORT");
    }
  });

  it("should fail on invalid log level", () => {
    const original = { ...Bun.env };
    Bun.env.GEMINI_API_KEY = "test-key";
    Bun.env.LOG_LEVEL = "verbose";

    const result = loadConfig();
    Object.assign(Bun.env, original);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Invalid LOG_LEVEL");
    }
  });

  it("should fail when GEMINI_API_KEY is missing for gemini provider", () => {
    const original = { ...Bun.env };
    delete Bun.env.GEMINI_API_KEY;
    delete Bun.env.PROVIDER_NAME; // defaults to "gemini"

    const result = loadConfig();
    Object.assign(Bun.env, original);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("GEMINI_API_KEY");
    }
  });

  it("should fail when AWS_REGION is missing for bedrock provider", () => {
    const original = { ...Bun.env };
    delete Bun.env.AWS_REGION;
    Bun.env.PROVIDER_NAME = "bedrock";

    const result = loadConfig();
    Object.assign(Bun.env, original);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("AWS_REGION");
    }
  });

  it("should configure bedrock provider with correct defaults", () => {
    const original = { ...Bun.env };
    Bun.env.PROVIDER_NAME = "bedrock";
    Bun.env.AWS_REGION = "us-west-2";
    delete Bun.env.PROVIDER_MODEL; // let it pick the bedrock default

    const result = loadConfig();
    Object.assign(Bun.env, original);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provider.name).toBe("bedrock");
      expect(result.value.provider.model).toContain("anthropic");
      expect(result.value.provider.region).toBe("us-west-2");
    }
  });
});
