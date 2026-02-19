// WebSearchTool: structured web retrieval via Brave Search API or SearXNG.
// Returns a ranked list of results (title, URL, snippet) -- never a synthesized answer.

import { SearchCache, buildCacheKey, isTimeSensitive } from "./cache";
import { RateLimiter } from "./rate-limiter";

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const BRAVE_BASE_URL = "https://api.search.brave.com/res/v1/web/search";

export type SearchProvider = "brave" | "searxng";

export interface WebSearchOptions {
  provider: SearchProvider;
  braveApiKey?: string;
  searxngUrl?: string;
  searxngUserAgent?: string;
  maxResults?: number;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

export interface SearchOptions {
  count?: number;
  freshness?: "pd" | "pw" | "pm" | "py";
  country?: string;
  searchLang?: string;
}

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  page_age?: string;
}

interface SearxngResult {
  title?: string;
  url?: string;
  content?: string;
  publishedDate?: string;
}

export class WebSearchTool {
  private readonly provider: SearchProvider;
  private readonly braveApiKey?: string;
  private readonly searxngUrl?: string;
  private readonly searxngUserAgent?: string;
  private readonly maxResults: number;
  private readonly timeoutMs: number;
  private readonly cache: SearchCache;
  private readonly cacheTtlMs: number;
  private readonly limiter: RateLimiter;

  constructor(opts: WebSearchOptions) {
    this.provider = opts.provider;
    this.braveApiKey = opts.braveApiKey;
    this.searxngUrl = opts.searxngUrl?.replace(/\/+$/, "");
    this.searxngUserAgent = opts.searxngUserAgent;
    this.maxResults = opts.maxResults ?? DEFAULT_MAX_RESULTS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.cache = new SearchCache();

    this.limiter =
      this.provider === "brave"
        ? new RateLimiter({ maxTokens: 3, refillPerSecond: 1 })
        : new RateLimiter({ maxTokens: 5, refillPerSecond: 2 });
  }

  async search(query: string, opts: SearchOptions = {}): Promise<string> {
    try {
      const count = Math.min(Math.max(opts.count ?? this.maxResults, 1), 10);
      const normalized = this.normalizeLocale(opts);

      // Check cache (skip for time-sensitive queries)
      if (!isTimeSensitive(query)) {
        const cacheKey = buildCacheKey("web_search", this.provider, query, {
          ...normalized,
          freshness: opts.freshness,
        });
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;
      }

      if (!this.limiter.acquire()) {
        return "Error: Rate limited — too many search requests in a short period. Please wait a moment and try again.";
      }

      const result =
        this.provider === "brave"
          ? await this.searchBrave(query, count, opts.freshness, normalized)
          : await this.searchSearxng(query, count, normalized);

      // Cache successful results
      if (!result.startsWith("Error:") && !isTimeSensitive(query)) {
        const cacheKey = buildCacheKey("web_search", this.provider, query, {
          ...normalized,
          freshness: opts.freshness,
        });
        this.cache.set(cacheKey, result, this.cacheTtlMs);
      }

      return result;
    } catch (err: unknown) {
      return `Error: Unexpected failure during web search — ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async searchBrave(
    query: string,
    count: number,
    freshness: string | undefined,
    locale: { country?: string; searchLang?: string },
  ): Promise<string> {
    if (!this.braveApiKey) {
      return "Error: BRAVE_API_KEY is not configured. Get one at https://api-dashboard.search.brave.com";
    }

    const params = new URLSearchParams({ q: query, count: String(count) });
    if (freshness) params.set("freshness", freshness);
    if (locale.country) params.set("country", locale.country);
    if (locale.searchLang) params.set("search_lang", locale.searchLang);

    const response = await globalThis.fetch(`${BRAVE_BASE_URL}?${params}`, {
      headers: {
        "X-Subscription-Token": this.braveApiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return "Error: Brave API authentication failed (HTTP " + response.status + "). Check your BRAVE_API_KEY.";
      }
      if (response.status === 429) {
        return "Error: Brave API rate limit exceeded. Please wait and try again.";
      }
      return `Error: Brave API returned HTTP ${response.status} ${response.statusText}`;
    }

    const data = await response.json();
    const results: BraveResult[] = data?.web?.results ?? [];

    if (results.length === 0) {
      return `Web search results for: "${query}"\nProvider: brave\n\nNo results found.`;
    }

    return this.formatResults(query, "brave", results.map((r) => ({
      title: r.title ?? "(untitled)",
      url: r.url ?? "",
      snippet: r.description ?? "",
      published: r.page_age ?? r.age,
    })), { count, freshness, ...locale });
  }

  private async searchSearxng(
    query: string,
    count: number,
    locale: { country?: string; searchLang?: string },
  ): Promise<string> {
    if (!this.searxngUrl) {
      return "Error: SEARXNG_URL is not configured. Set it to your SearXNG instance URL (e.g. http://localhost:8080).";
    }

    const params = new URLSearchParams({ q: query, format: "json" });
    if (locale.searchLang) params.set("language", locale.searchLang);

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.searxngUserAgent) headers["User-Agent"] = this.searxngUserAgent;

    const response = await globalThis.fetch(`${this.searxngUrl}/search?${params}`, {
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (response.status === 403) {
      return (
        "Error: SearXNG returned 403 Forbidden. JSON output must be enabled in settings.yml:\n\n" +
        "  search:\n" +
        "    formats:\n" +
        "      - html\n" +
        "      - json\n\n" +
        "Then restart the SearXNG instance.\n" +
        "See https://docs.searxng.org/dev/search_api.html"
      );
    }

    if (!response.ok) {
      return `Error: SearXNG returned HTTP ${response.status} ${response.statusText}`;
    }

    const data = await response.json();
    const results: SearxngResult[] = (data?.results ?? []).slice(0, count);

    if (results.length === 0) {
      return `Web search results for: "${query}"\nProvider: searxng\n\nNo results found.`;
    }

    return this.formatResults(query, "searxng", results.map((r) => ({
      title: r.title ?? "(untitled)",
      url: r.url ?? "",
      snippet: r.content ?? "",
      published: r.publishedDate,
    })), { count, ...locale });
  }

  private formatResults(
    query: string,
    provider: string,
    results: Array<{ title: string; url: string; snippet: string; published?: string }>,
    params: Record<string, unknown>,
  ): string {
    const paramParts: string[] = [];
    if (params.count) paramParts.push(`count=${params.count}`);
    if (params.freshness) paramParts.push(`freshness=${params.freshness}`);
    if (params.country) paramParts.push(`country=${params.country}`);
    if (params.searchLang) paramParts.push(`lang=${params.searchLang}`);

    let out = `Web search results for: "${query}"\n`;
    out += `Provider: ${provider}\n`;
    if (paramParts.length > 0) out += `Params: ${paramParts.join(", ")}\n`;
    out += "\n";

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      out += `${i + 1}) ${r.title}\n`;
      out += `   URL: ${r.url}\n`;
      if (r.published) out += `   Published: ${r.published}\n`;
      if (r.snippet) out += `   Snippet: ${r.snippet}\n`;
      out += "\n";
    }

    return out.trimEnd();
  }

  /**
   * Normalize locale: split "da-DK" into searchLang="da" + country="DK".
   * Passthrough if already separate.
   */
  private normalizeLocale(opts: SearchOptions): { country?: string; searchLang?: string } {
    let { country, searchLang } = opts;

    if (searchLang && searchLang.includes("-")) {
      const [lang, region] = searchLang.split("-");
      searchLang = lang;
      if (!country && region) country = region.toUpperCase();
    }

    if (country) country = country.toUpperCase();
    if (searchLang) searchLang = searchLang.toLowerCase();

    return {
      country: country || undefined,
      searchLang: searchLang || undefined,
    };
  }
}
