// Configuration schema + validation

import { type Result, ok, err, ConfigError } from "./types";
import type { LogLevel } from "./types";

export interface SpaceduckConfig {
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly provider: {
    readonly name: string;
    readonly model?: string;
    readonly region?: string;
  };
  readonly memory: {
    readonly backend: string;
    readonly connectionString: string;
  };
  readonly channels: readonly string[];
  readonly systemPrompt?: string;
}

function requireEnv(key: string): Result<string, ConfigError> {
  const value = Bun.env[key];
  if (value === undefined || value === "") {
    return err(new ConfigError(`Missing required env var: ${key}`));
  }
  return ok(value);
}

function optionalEnv(key: string, defaultValue: string): string {
  return Bun.env[key] || defaultValue;
}

/**
 * Load and validate configuration from environment variables.
 * Returns Result — never throws.
 */
export function loadConfig(): Result<SpaceduckConfig, ConfigError> {
  const portStr = optionalEnv("PORT", "3000");
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    return err(new ConfigError(`Invalid PORT: ${portStr} (must be 1-65535)`));
  }

  const logLevel = optionalEnv("LOG_LEVEL", "info") as LogLevel;
  const validLogLevels = ["debug", "info", "warn", "error"];
  if (!validLogLevels.includes(logLevel)) {
    return err(new ConfigError(`Invalid LOG_LEVEL: ${logLevel} (must be one of: ${validLogLevels.join(", ")})`));
  }

  const providerName = optionalEnv("PROVIDER_NAME", "gemini");

  // Provider-specific validation
  if (providerName === "gemini") {
    const apiKey = requireEnv("GEMINI_API_KEY");
    if (!apiKey.ok) return apiKey;
  } else if (providerName === "bedrock") {
    const region = requireEnv("AWS_REGION");
    if (!region.ok) return region;
  } else if (providerName === "openrouter") {
    const apiKey = requireEnv("OPENROUTER_API_KEY");
    if (!apiKey.ok) return apiKey;
  } else if (providerName === "lmstudio") {
    // No required env vars — LM Studio runs locally without auth
  }

  const config: SpaceduckConfig = {
    port,
    logLevel,
    provider: {
      name: providerName,
      model: optionalEnv("PROVIDER_MODEL",
        providerName === "gemini" ? "gemini-2.5-flash"
        : providerName === "openrouter" ? "nvidia/nemotron-3-nano-30b-a3b:free"
        : providerName === "lmstudio" ? "qwen/qwen3-4b-thinking-2507"
        : "us.anthropic.claude-sonnet-4-20250514:0"),
      region: providerName === "bedrock" ? optionalEnv("AWS_REGION", "us-east-1") : undefined,
    },
    memory: {
      backend: optionalEnv("MEMORY_BACKEND", "sqlite"),
      connectionString: optionalEnv("MEMORY_CONNECTION_STRING", "spaceduck.db"),
    },
    channels: ["web"],
    systemPrompt: Bun.env.SYSTEM_PROMPT || undefined,
  };

  return ok(config);
}
