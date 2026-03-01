// Per-model cost estimation from exact token counts.
//
// Ships hardcoded defaults for known models. Users can override via
// scheduler.pricing in config. Falls back to a conservative mid-tier
// rate ($1/M input, $5/M output) with a log warning when model is unknown.
//
// Cache-aware: when ProviderUsage includes cacheReadTokens/cacheWriteTokens,
// those are priced at per-model discount/multiplier rates instead of full input price.

import type { Logger, ProviderUsage } from "@spaceduck/core";

export interface ModelPricing {
  readonly inputPer1MTokens: number;
  readonly outputPer1MTokens: number;
  /** Multiplier for cache-read tokens (e.g. 0.1 = 90% cheaper than input). */
  readonly cacheReadDiscount?: number;
  /** Multiplier for cache-write tokens (e.g. 1.0 = same as input rate). */
  readonly cacheWriteMultiplier?: number;
}

const FALLBACK_PRICING: ModelPricing = {
  inputPer1MTokens: 1.0,
  outputPer1MTokens: 5.0,
};

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // Amazon Bedrock — cache reads at ~10% of input rate
  "global.amazon.nova-2-lite-v1:0":       { inputPer1MTokens: 0.06, outputPer1MTokens: 0.24, cacheReadDiscount: 0.1, cacheWriteMultiplier: 1.0 },
  "amazon.nova-pro-v1:0":                 { inputPer1MTokens: 0.80, outputPer1MTokens: 3.20, cacheReadDiscount: 0.1, cacheWriteMultiplier: 1.0 },
  "us.anthropic.claude-3-5-haiku-20241022-v1:0": { inputPer1MTokens: 0.80, outputPer1MTokens: 4.00, cacheReadDiscount: 0.1, cacheWriteMultiplier: 1.0 },

  // OpenRouter / OpenAI — cache reads at 50% of input rate
  "gpt-4o-mini":                          { inputPer1MTokens: 0.15, outputPer1MTokens: 0.60, cacheReadDiscount: 0.5, cacheWriteMultiplier: 1.0 },
  "gpt-4o":                               { inputPer1MTokens: 2.50, outputPer1MTokens: 10.00, cacheReadDiscount: 0.5, cacheWriteMultiplier: 1.0 },
  "anthropic/claude-3.5-sonnet":          { inputPer1MTokens: 3.00, outputPer1MTokens: 15.00, cacheReadDiscount: 0.1, cacheWriteMultiplier: 1.25 },
  "anthropic/claude-3-haiku":             { inputPer1MTokens: 0.25, outputPer1MTokens: 1.25, cacheReadDiscount: 0.1, cacheWriteMultiplier: 1.25 },

  // Google Gemini — cache reads at 25% of input rate
  "gemini-2.5-flash":                     { inputPer1MTokens: 0.15, outputPer1MTokens: 0.60, cacheReadDiscount: 0.25, cacheWriteMultiplier: 1.0 },
  "gemini-2.0-flash":                     { inputPer1MTokens: 0.10, outputPer1MTokens: 0.40, cacheReadDiscount: 0.25, cacheWriteMultiplier: 1.0 },
  "gemini-1.5-pro":                       { inputPer1MTokens: 1.25, outputPer1MTokens: 5.00, cacheReadDiscount: 0.25, cacheWriteMultiplier: 1.0 },
};

export class PricingLookup {
  private readonly merged: Record<string, ModelPricing>;
  private readonly warnedModels = new Set<string>();

  constructor(
    private readonly logger: Logger,
    configOverrides?: Record<string, ModelPricing>,
  ) {
    this.merged = { ...DEFAULT_PRICING, ...configOverrides };
  }

  estimate(model: string, usage: ProviderUsage): number {
    const pricing = this.merged[model];

    if (!pricing) {
      if (!this.warnedModels.has(model)) {
        this.warnedModels.add(model);
        this.logger.warn("Unknown model for cost estimation, using fallback rate", {
          model,
          fallbackInput: `$${FALLBACK_PRICING.inputPer1MTokens}/M`,
          fallbackOutput: `$${FALLBACK_PRICING.outputPer1MTokens}/M`,
        });
      }
      return estimateFromPricing(FALLBACK_PRICING, usage);
    }

    return estimateFromPricing(pricing, usage);
  }
}

function estimateFromPricing(p: ModelPricing, usage: ProviderUsage): number {
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const uncachedInput = usage.inputTokens - cacheRead;
  const inputRate = p.inputPer1MTokens;

  return (uncachedInput / 1_000_000) * inputRate
       + (cacheRead / 1_000_000) * inputRate * (p.cacheReadDiscount ?? 1.0)
       + (cacheWrite / 1_000_000) * inputRate * (p.cacheWriteMultiplier ?? 1.0)
       + (usage.outputTokens / 1_000_000) * p.outputPer1MTokens;
}
