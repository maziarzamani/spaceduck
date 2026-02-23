import { describe, it, expect } from "bun:test";
import { loadConfig } from "../config";

describe("loadConfig", () => {
  it("should return valid config with Gemini defaults", () => {
    const original = { ...Bun.env };
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
      expect(result.value.provider.model).toBeUndefined();
    }
  });

  it("should use defaults when optional env vars are missing", () => {
    const original = { ...Bun.env };
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
    Bun.env.LOG_LEVEL = "verbose";

    const result = loadConfig();
    Object.assign(Bun.env, original);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Invalid LOG_LEVEL");
    }
  });

  it("should accept gemini provider without API key (keys validated elsewhere)", () => {
    const original = { ...Bun.env };
    delete Bun.env.GEMINI_API_KEY;
    delete Bun.env.PROVIDER_NAME;

    const result = loadConfig();
    Object.assign(Bun.env, original);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provider.name).toBe("gemini");
    }
  });

  it("should accept bedrock provider without AWS_REGION (validated elsewhere)", () => {
    const original = { ...Bun.env };
    delete Bun.env.AWS_REGION;
    Bun.env.PROVIDER_NAME = "bedrock";

    const result = loadConfig();
    Object.assign(Bun.env, original);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provider.name).toBe("bedrock");
    }
  });

  it("should configure bedrock provider with region", () => {
    const original = { ...Bun.env };
    Bun.env.PROVIDER_NAME = "bedrock";
    Bun.env.AWS_REGION = "us-west-2";
    delete Bun.env.PROVIDER_MODEL;

    const result = loadConfig();
    Object.assign(Bun.env, original);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provider.name).toBe("bedrock");
      expect(result.value.provider.model).toBeUndefined();
      expect(result.value.provider.region).toBe("us-west-2");
    }
  });

  it("should use PROVIDER_MODEL when set", () => {
    const original = { ...Bun.env };
    Bun.env.PROVIDER_NAME = "bedrock";
    Bun.env.PROVIDER_MODEL = "anthropic.claude-v3";
    Bun.env.AWS_REGION = "us-east-1";

    const result = loadConfig();
    Object.assign(Bun.env, original);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provider.model).toBe("anthropic.claude-v3");
    }
  });
});
