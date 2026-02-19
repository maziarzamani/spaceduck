// In-memory TTL cache with LRU eviction for web search/answer results.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 200;

export class SearchCache<T = string> {
  private readonly map = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }

    // LRU: move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    // Evict oldest entries if at capacity
    while (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }

    this.map.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

// Time-sensitive query patterns that should bypass caching entirely
const TIME_SENSITIVE_PATTERNS = [
  /\btoday\b/i,
  /\blatest\b/i,
  /\bbreaking\b/i,
  /\bjust now\b/i,
  /\bthis hour\b/i,
  /\bright now\b/i,
  /\b20\d{2}-\d{2}-\d{2}\b/, // ISO date patterns
];

export function isTimeSensitive(query: string): boolean {
  return TIME_SENSITIVE_PATTERNS.some((p) => p.test(query));
}

/**
 * Build a normalized cache key from all dimensions that affect results.
 * Ensures no "wrong language" or "wrong provider" cache hits.
 */
export function buildCacheKey(
  tool: string,
  provider: string,
  query: string,
  opts: Record<string, unknown> = {},
): string {
  const parts = [
    tool,
    provider,
    query.toLowerCase().trim(),
    opts.freshness ?? "",
    opts.country ?? "",
    opts.searchLang ?? "",
    opts.model ?? "",
  ];
  return parts.join("|");
}
