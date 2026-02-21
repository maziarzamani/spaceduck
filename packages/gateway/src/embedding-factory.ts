// Embedding provider factory — creates the appropriate EmbeddingProvider
// based on configuration. Keeps gateway.ts lean and testable.

import type { SpaceduckConfig, Logger, EmbeddingProvider } from "@spaceduck/core";
import { ConfigError } from "@spaceduck/core";
import type { SpaceduckProductConfig } from "@spaceduck/config";

/**
 * Create an EmbeddingProvider from env + product config.
 * API keys are resolved from env first, then from product config secrets.
 * Returns undefined if embeddings are disabled.
 * Throws ConfigError on misconfiguration (fail-fast at startup).
 */
export function createEmbeddingProvider(
  config: SpaceduckConfig,
  logger: Logger,
  productConfig?: SpaceduckProductConfig,
): EmbeddingProvider | undefined {
  const enabled = Bun.env.EMBEDDING_ENABLED !== "false";
  if (!enabled) {
    logger.info("Embeddings disabled via EMBEDDING_ENABLED=false");
    return undefined;
  }

  const providerName = Bun.env.EMBEDDING_PROVIDER ?? config.provider.name;
  const model = Bun.env.EMBEDDING_MODEL;
  const dimensions = Bun.env.EMBEDDING_DIMENSIONS
    ? parseInt(Bun.env.EMBEDDING_DIMENSIONS, 10)
    : undefined;

  if (dimensions !== undefined && (isNaN(dimensions) || dimensions < 1)) {
    throw new ConfigError(
      `Invalid EMBEDDING_DIMENSIONS: "${Bun.env.EMBEDDING_DIMENSIONS}" (must be a positive integer)`,
    );
  }

  let provider: EmbeddingProvider;

  switch (providerName) {
    case "lmstudio": {
      const { LMStudioEmbeddingProvider } = require("@spaceduck/provider-lmstudio");
      provider = new LMStudioEmbeddingProvider({
        model: model ?? "text-embedding-qwen3-embedding-8b",
        baseUrl: Bun.env.LMSTUDIO_BASE_URL,
        apiKey: Bun.env.LMSTUDIO_API_KEY ?? productConfig?.ai.secrets.lmstudioApiKey,
        dimensions: dimensions ?? 4096,
        instruction: Bun.env.EMBEDDING_INSTRUCTION,
      });
      break;
    }
    case "gemini": {
      const { GeminiEmbeddingProvider } = require("@spaceduck/provider-gemini");
      const apiKey = Bun.env.GEMINI_API_KEY ?? productConfig?.ai.secrets.geminiApiKey;
      if (!apiKey) {
        throw new ConfigError(
          "Gemini API key is required for embedding. Set it in Settings or via GEMINI_API_KEY env var.",
        );
      }
      provider = new GeminiEmbeddingProvider({
        apiKey,
        model: model ?? undefined,
      });
      break;
    }
    case "bedrock": {
      const { BedrockEmbeddingProvider } = require("@spaceduck/provider-bedrock");
      const dims = dimensions ?? 1024;
      const effectiveModel = model ?? "amazon.titan-embed-text-v2:0";
      const isNova = effectiveModel.includes("nova");
      const validDims = isNova ? [256, 384, 1024, 3072] : [256, 512, 1024];
      if (!validDims.includes(dims)) {
        const modelLabel = isNova ? "Nova 2 Multimodal Embeddings" : "Titan Embeddings V2";
        throw new ConfigError(
          `${modelLabel} supports dimensions ${validDims.join(", ")}. Got: ${dims}`,
        );
      }
      provider = new BedrockEmbeddingProvider({
        model: effectiveModel,
        dimensions: dims,
        region: Bun.env.AWS_REGION ?? productConfig?.ai.region,
        apiKey:
          Bun.env.AWS_BEARER_TOKEN_BEDROCK ??
          Bun.env.BEDROCK_API_KEY ??
          productConfig?.ai.secrets.bedrockApiKey ??
          undefined,
      });
      break;
    }
    default: {
      logger.warn("No embedding provider available", { providerName });
      return undefined;
    }
  }

  // Fail-fast: verify configured dimensions match provider dimensions
  if (dimensions !== undefined && provider.dimensions !== dimensions) {
    throw new ConfigError(
      `EMBEDDING_DIMENSIONS=${dimensions} does not match provider "${provider.name}" dimensions=${provider.dimensions}. ` +
        `Either change EMBEDDING_DIMENSIONS or reconfigure the provider.`,
    );
  }

  logger.info("Embedding provider created", {
    provider: provider.name,
    model: model ?? "(default)",
    dimensions: provider.dimensions,
  });

  return provider;
}
