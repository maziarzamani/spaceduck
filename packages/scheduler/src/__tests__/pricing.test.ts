import { describe, it, expect } from "bun:test";
import { PricingLookup } from "../pricing";
import type { Logger, ProviderUsage } from "@spaceduck/core";

function createLogger(): Logger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    info: () => {},
    debug: () => {},
    warn: (_msg: string, data?: any) => { warnings.push(data?.model ?? _msg); },
    error: () => {},
    child: () => createLogger(),
  } as any;
}

function usage(input: number, output: number, opts?: { cacheRead?: number; cacheWrite?: number }): ProviderUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    ...(opts?.cacheRead != null && { cacheReadTokens: opts.cacheRead }),
    ...(opts?.cacheWrite != null && { cacheWriteTokens: opts.cacheWrite }),
  };
}

describe("PricingLookup", () => {
  it("estimates cost for known model", () => {
    const logger = createLogger();
    const lookup = new PricingLookup(logger);

    // Nova Lite: $0.06/M input, $0.24/M output
    const cost = lookup.estimate("global.amazon.nova-2-lite-v1:0", usage(1000, 100));

    const expected = (1000 / 1_000_000) * 0.06 + (100 / 1_000_000) * 0.24;
    expect(cost).toBeCloseTo(expected, 10);
    expect(logger.warnings).toHaveLength(0);
  });

  it("falls back to default rate for unknown model and warns once", () => {
    const logger = createLogger();
    const lookup = new PricingLookup(logger);

    const cost1 = lookup.estimate("custom/my-model", usage(1_000_000, 500_000));
    lookup.estimate("custom/my-model", usage(100, 50));

    // Fallback: $1/M input, $5/M output
    expect(cost1).toBeCloseTo(1.0 + 2.5, 6);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toBe("custom/my-model");
  });

  it("config overrides take precedence over defaults", () => {
    const logger = createLogger();
    const lookup = new PricingLookup(logger, {
      "gemini-2.5-flash": { inputPer1MTokens: 0.50, outputPer1MTokens: 1.50 },
    });

    const cost = lookup.estimate("gemini-2.5-flash", usage(1_000_000, 1_000_000));

    expect(cost).toBeCloseTo(0.50 + 1.50, 6);
  });

  it("config can add new models", () => {
    const logger = createLogger();
    const lookup = new PricingLookup(logger, {
      "my-org/custom-model": { inputPer1MTokens: 2.0, outputPer1MTokens: 8.0 },
    });

    const cost = lookup.estimate("my-org/custom-model", usage(500_000, 100_000));

    expect(cost).toBeCloseTo(1.0 + 0.8, 6);
    expect(logger.warnings).toHaveLength(0);
  });

  it("returns 0 cost for 0 tokens", () => {
    const logger = createLogger();
    const lookup = new PricingLookup(logger);

    expect(lookup.estimate("gemini-2.5-flash", usage(0, 0))).toBe(0);
  });

  // --- Cache-aware pricing ---

  it("applies cache read discount for Bedrock models", () => {
    const logger = createLogger();
    const lookup = new PricingLookup(logger);

    // Nova Lite: $0.06/M input, cacheReadDiscount = 0.1
    // 1000 total input, 600 from cache, 100 output
    const cost = lookup.estimate(
      "global.amazon.nova-2-lite-v1:0",
      usage(1000, 100, { cacheRead: 600 }),
    );

    // uncachedInput = 400, cacheRead = 600
    // (400/1M)*0.06 + (600/1M)*0.06*0.1 + (100/1M)*0.24
    const expected = (400 / 1e6) * 0.06 + (600 / 1e6) * 0.06 * 0.1 + (100 / 1e6) * 0.24;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("applies cache read discount for OpenAI models", () => {
    const logger = createLogger();
    const lookup = new PricingLookup(logger);

    // gpt-4o: $2.50/M input, cacheReadDiscount = 0.5
    const cost = lookup.estimate(
      "gpt-4o",
      usage(10_000, 1_000, { cacheRead: 5_000 }),
    );

    // uncached = 5000, cacheRead = 5000
    const expected = (5_000 / 1e6) * 2.50 + (5_000 / 1e6) * 2.50 * 0.5 + (1_000 / 1e6) * 10.00;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("applies cache write multiplier", () => {
    const logger = createLogger();
    const lookup = new PricingLookup(logger);

    // anthropic/claude-3.5-sonnet: cacheWriteMultiplier = 1.25
    const cost = lookup.estimate(
      "anthropic/claude-3.5-sonnet",
      usage(10_000, 1_000, { cacheWrite: 3_000 }),
    );

    // uncachedInput = 10000, cacheWrite = 3000
    const expected = (10_000 / 1e6) * 3.00
                   + (3_000 / 1e6) * 3.00 * 1.25
                   + (1_000 / 1e6) * 15.00;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("applies both cache read and write together", () => {
    const logger = createLogger();
    const lookup = new PricingLookup(logger);

    // anthropic/claude-3.5-sonnet: cacheReadDiscount=0.1, cacheWriteMultiplier=1.25
    const cost = lookup.estimate(
      "anthropic/claude-3.5-sonnet",
      usage(10_000, 1_000, { cacheRead: 4_000, cacheWrite: 2_000 }),
    );

    // uncachedInput = 10000 - 4000 = 6000
    const expected = (6_000 / 1e6) * 3.00
                   + (4_000 / 1e6) * 3.00 * 0.1
                   + (2_000 / 1e6) * 3.00 * 1.25
                   + (1_000 / 1e6) * 15.00;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("cache fields are optional — no cache tokens = full input pricing", () => {
    const logger = createLogger();
    const lookup = new PricingLookup(logger);

    const withCache = lookup.estimate(
      "gpt-4o",
      usage(10_000, 1_000, { cacheRead: 0 }),
    );
    const withoutCache = lookup.estimate(
      "gpt-4o",
      usage(10_000, 1_000),
    );

    expect(withCache).toBeCloseTo(withoutCache, 12);
  });

  it("config override can set cache discount for new models", () => {
    const logger = createLogger();
    const lookup = new PricingLookup(logger, {
      "local/my-model": {
        inputPer1MTokens: 0.0,
        outputPer1MTokens: 0.0,
        cacheReadDiscount: 0.5,
      },
    });

    // Free model — cost is always 0 regardless of cache
    const cost = lookup.estimate("local/my-model", usage(1_000_000, 500_000, { cacheRead: 500_000 }));
    expect(cost).toBe(0);
  });

  it("fallback pricing has no cache discount (all input at full rate)", () => {
    const logger = createLogger();
    const lookup = new PricingLookup(logger);

    // Unknown model, cache fields present but fallback has no cacheReadDiscount
    const cost = lookup.estimate(
      "unknown-model",
      usage(10_000, 1_000, { cacheRead: 5_000 }),
    );

    // cacheReadDiscount defaults to 1.0 for fallback — effectively full price
    const expected = (5_000 / 1e6) * 1.0 + (5_000 / 1e6) * 1.0 * 1.0 + (1_000 / 1e6) * 5.0;
    expect(cost).toBeCloseTo(expected, 10);
  });
});
