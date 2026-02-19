// Simple token bucket rate limiter per provider.
// Prevents bursty agent tool calls from blowing through API quotas.

export interface RateLimiterOptions {
  /** Maximum burst tokens */
  readonly maxTokens: number;
  /** Tokens added per second */
  readonly refillPerSecond: number;
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillPerSecond: number;

  constructor(opts: RateLimiterOptions) {
    this.maxTokens = opts.maxTokens;
    this.refillPerSecond = opts.refillPerSecond;
    this.tokens = opts.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Try to acquire a token. Returns true if allowed, false if rate limited.
   */
  acquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefill = now;
  }
}
