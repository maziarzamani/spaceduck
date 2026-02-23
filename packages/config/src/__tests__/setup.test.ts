import { describe, expect, test } from "bun:test";
import {
  ONBOARDING_VERSION,
  CLOUD_PROVIDERS,
  LOCAL_PROVIDERS,
  LOCAL_PRESET_URLS,
  CLOUD_DEFAULT_MODELS,
  SECRET_LABELS,
  LOCAL_MODEL_RECOMMENDATIONS,
  recommendTier,
  buildLocalPatch,
  buildCloudPatch,
  buildAdvancedPatch,
  buildOnboardingCompletePatch,
  buildOnboardingSkipPatch,
  buildOnboardingLastStepPatch,
  validateLocalSetup,
  validateCloudSetup,
} from "../setup";

describe("setup constants", () => {
  test("ONBOARDING_VERSION is a positive integer", () => {
    expect(ONBOARDING_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(ONBOARDING_VERSION)).toBe(true);
  });

  test("CLOUD_PROVIDERS has at least one recommended", () => {
    const recs = CLOUD_PROVIDERS.filter((p) => p.recommended);
    expect(recs.length).toBeGreaterThanOrEqual(1);
  });

  test("LOCAL_PROVIDERS has at least one recommended", () => {
    const recs = LOCAL_PROVIDERS.filter((p) => p.recommended);
    expect(recs.length).toBeGreaterThanOrEqual(1);
  });

  test("LOCAL_PRESET_URLS has entries for non-custom local providers", () => {
    expect(LOCAL_PRESET_URLS["lmstudio"]).toContain("localhost");
    expect(LOCAL_PRESET_URLS["llamacpp"]).toContain("127.0.0.1");
  });

  test("CLOUD_DEFAULT_MODELS has entry for each cloud provider", () => {
    for (const p of CLOUD_PROVIDERS) {
      expect(CLOUD_DEFAULT_MODELS[p.id]).toBeDefined();
    }
  });

  test("SECRET_LABELS has entries for cloud and local providers", () => {
    expect(SECRET_LABELS["gemini"]).toBeDefined();
    expect(SECRET_LABELS["openrouter"]).toBeDefined();
    expect(SECRET_LABELS["bedrock"]).toBeDefined();
    expect(SECRET_LABELS["lmstudio"]).toBeDefined();
    expect(SECRET_LABELS["llamacpp"]).toBeDefined();
  });

  test("LOCAL_MODEL_RECOMMENDATIONS covers all tiers", () => {
    expect(LOCAL_MODEL_RECOMMENDATIONS.small).toBeDefined();
    expect(LOCAL_MODEL_RECOMMENDATIONS.medium).toBeDefined();
    expect(LOCAL_MODEL_RECOMMENDATIONS.large).toBeDefined();
    expect(LOCAL_MODEL_RECOMMENDATIONS.small.sizeGB).toBeLessThan(
      LOCAL_MODEL_RECOMMENDATIONS.medium.sizeGB,
    );
  });
});

describe("recommendTier", () => {
  test("null memory -> small", () => {
    expect(recommendTier(null)).toBe("small");
  });

  test("4 GB -> small", () => {
    expect(recommendTier(4)).toBe("small");
  });

  test("16 GB -> medium", () => {
    expect(recommendTier(16)).toBe("medium");
  });

  test("64 GB -> large", () => {
    expect(recommendTier(64)).toBe("large");
  });

  test("boundary: 8 GB -> medium", () => {
    expect(recommendTier(8)).toBe("medium");
  });

  test("boundary: 32 GB -> large", () => {
    expect(recommendTier(32)).toBe("large");
  });
});

describe("buildLocalPatch", () => {
  test("lmstudio provider with preset URL", () => {
    const ops = buildLocalPatch("lmstudio", "http://localhost:1234/v1");
    expect(ops).toEqual([
      { op: "replace", path: "/ai/provider", value: "lmstudio" },
      { op: "replace", path: "/ai/baseUrl", value: "http://localhost:1234/v1" },
      { op: "replace", path: "/ai/model", value: null },
    ]);
  });

  test("custom provider maps to llamacpp", () => {
    const ops = buildLocalPatch("custom", "http://my-server:9999/v1");
    expect(ops[0].value).toBe("llamacpp");
  });

  test("empty baseUrl becomes null", () => {
    const ops = buildLocalPatch("lmstudio", "");
    expect(ops[1].value).toBeNull();
  });
});

describe("buildCloudPatch", () => {
  test("gemini provider", () => {
    const ops = buildCloudPatch("gemini", "gemini-2.5-flash");
    expect(ops).toContainEqual({ op: "replace", path: "/ai/provider", value: "gemini" });
    expect(ops).toContainEqual({ op: "replace", path: "/ai/model", value: "gemini-2.5-flash" });
    expect(ops).toContainEqual({ op: "replace", path: "/ai/baseUrl", value: null });
  });

  test("bedrock with region", () => {
    const ops = buildCloudPatch("bedrock", "us.amazon.nova-2-pro-v1:0", "us-east-1");
    expect(ops).toContainEqual({ op: "replace", path: "/ai/region", value: "us-east-1" });
  });

  test("non-bedrock does not add region", () => {
    const ops = buildCloudPatch("gemini", "gemini-2.5-flash", "us-east-1");
    expect(ops.find((o) => o.path === "/ai/region")).toBeUndefined();
  });
});

describe("buildAdvancedPatch", () => {
  test("chat-only config", () => {
    const ops = buildAdvancedPatch({ provider: "lmstudio", baseUrl: "http://localhost:1234/v1" });
    expect(ops).toContainEqual({ op: "replace", path: "/ai/provider", value: "lmstudio" });
    expect(ops.find((o) => o.path.startsWith("/embedding/"))).toBeUndefined();
  });

  test("with embedding config", () => {
    const ops = buildAdvancedPatch({
      provider: "gemini",
      model: "gemini-2.5-flash",
      embeddingProvider: "gemini",
      embeddingModel: "text-embedding-004",
    });
    expect(ops).toContainEqual({ op: "replace", path: "/embedding/provider", value: "gemini" });
    expect(ops).toContainEqual({ op: "replace", path: "/embedding/model", value: "text-embedding-004" });
  });
});

describe("buildOnboardingCompletePatch", () => {
  test("produces correct ops", () => {
    const ops = buildOnboardingCompletePatch("cloud", 1);
    expect(ops).toContainEqual({ op: "replace", path: "/onboarding/completed", value: true });
    expect(ops).toContainEqual({ op: "replace", path: "/onboarding/mode", value: "cloud" });
    expect(ops).toContainEqual({ op: "replace", path: "/onboarding/versionCompleted", value: 1 });
    const completedAt = ops.find((o) => o.path === "/onboarding/completedAt");
    expect(completedAt).toBeDefined();
    expect(typeof completedAt!.value).toBe("string");
  });
});

describe("buildOnboardingSkipPatch", () => {
  test("sets skippedAt to ISO timestamp", () => {
    const ops = buildOnboardingSkipPatch();
    expect(ops).toHaveLength(1);
    expect(ops[0].path).toBe("/onboarding/skippedAt");
    expect(typeof ops[0].value).toBe("string");
  });
});

describe("buildOnboardingLastStepPatch", () => {
  test("sets lastStep", () => {
    const ops = buildOnboardingLastStepPatch("setup-cloud");
    expect(ops).toEqual([{ op: "replace", path: "/onboarding/lastStep", value: "setup-cloud" }]);
  });
});

describe("validateLocalSetup", () => {
  test("no provider -> error", () => {
    expect(validateLocalSetup("", "").ok).toBe(false);
  });

  test("known provider without URL -> ok (uses preset)", () => {
    expect(validateLocalSetup("lmstudio", "").ok).toBe(true);
  });

  test("custom provider with valid URL -> ok", () => {
    expect(validateLocalSetup("custom", "http://localhost:9999/v1").ok).toBe(true);
  });

  test("custom provider with invalid URL -> error", () => {
    expect(validateLocalSetup("custom", "not-a-url").ok).toBe(false);
  });
});

describe("validateCloudSetup", () => {
  test("no provider -> error", () => {
    expect(validateCloudSetup("", "").ok).toBe(false);
  });

  test("provider without model -> error", () => {
    expect(validateCloudSetup("gemini", "").ok).toBe(false);
  });

  test("provider with model -> ok", () => {
    expect(validateCloudSetup("gemini", "gemini-2.5-flash").ok).toBe(true);
  });
});
