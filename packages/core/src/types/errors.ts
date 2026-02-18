// Error types and Result monad for explicit error handling

export type Result<T, E = SpaceduckError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export class SpaceduckError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SpaceduckError";
  }
}

export class ProviderError extends SpaceduckError {
  constructor(
    message: string,
    public readonly providerCode?: string,
    cause?: unknown,
  ) {
    super(message, "PROVIDER_ERROR", cause);
    this.name = "ProviderError";
  }
}

export class MemoryError extends SpaceduckError {
  constructor(message: string, cause?: unknown) {
    super(message, "MEMORY_ERROR", cause);
    this.name = "MemoryError";
  }
}

export class ChannelError extends SpaceduckError {
  constructor(message: string, cause?: unknown) {
    super(message, "CHANNEL_ERROR", cause);
    this.name = "ChannelError";
  }
}

export class ConfigError extends SpaceduckError {
  constructor(message: string, cause?: unknown) {
    super(message, "CONFIG_ERROR", cause);
    this.name = "ConfigError";
  }
}

export class SessionError extends SpaceduckError {
  constructor(message: string, cause?: unknown) {
    super(message, "SESSION_ERROR", cause);
    this.name = "SessionError";
  }
}
