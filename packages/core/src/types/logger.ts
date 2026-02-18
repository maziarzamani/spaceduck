// Logger interface for structured logging

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  /** Create a child logger with additional context fields. */
  child(context: Record<string, unknown>): Logger;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Simple console logger that writes structured JSON to stdout.
 * Swappable for Pino, Winston, etc. later.
 */
export class ConsoleLogger implements Logger {
  private readonly context: Record<string, unknown>;
  private readonly minLevel: number;

  constructor(
    private readonly level: LogLevel = "info",
    context: Record<string, unknown> = {},
  ) {
    this.context = context;
    this.minLevel = LEVEL_ORDER[level];
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  child(context: Record<string, unknown>): Logger {
    return new ConsoleLogger(this.level, { ...this.context, ...context });
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;

    const entry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...this.context,
      ...data,
    };

    const output = JSON.stringify(entry);

    if (level === "error") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
}
