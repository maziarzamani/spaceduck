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

function optionalEnv(key: string, defaultValue: string): string {
  return Bun.env[key] || defaultValue;
}

/**
 * Load and validate deployment configuration from environment variables.
 * Product config (provider, model, keys, etc.) lives in spaceduck.config.json5.
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

  const config: SpaceduckConfig = {
    port,
    logLevel,
    provider: {
      name: optionalEnv("PROVIDER_NAME", "gemini"),
      model: Bun.env.PROVIDER_MODEL || undefined,
      region: Bun.env.AWS_REGION || undefined,
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
