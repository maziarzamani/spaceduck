// WebAnswerTool: synthesized answers with citations via Perplexity Sonar.
// Returns an AI-generated answer grounded in real-time web search, with source URLs.
// Prefers direct Perplexity API for reliable citations; falls back to OpenRouter.

import { SearchCache, buildCacheKey, isTimeSensitive } from "./cache";
import { RateLimiter } from "./rate-limiter";

const DEFAULT_MODEL = "sonar-pro";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (shorter than search)

const PERPLEXITY_BASE_URL = "https://api.perplexity.ai";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

type AnswerProvider = "perplexity-direct" | "openrouter";

export interface WebAnswerOptions {
  perplexityApiKey?: string;
  openrouterApiKey?: string;
  model?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

export interface AnswerOptions {
  searchLang?: string;
}

interface PerplexityCitation {
  url?: string;
  title?: string;
}

export class WebAnswerTool {
  private readonly provider: AnswerProvider;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly cache: SearchCache;
  private readonly cacheTtlMs: number;
  private readonly limiter: RateLimiter;

  constructor(opts: WebAnswerOptions) {
    if (opts.perplexityApiKey) {
      this.provider = "perplexity-direct";
      this.apiKey = opts.perplexityApiKey;
      this.baseUrl = PERPLEXITY_BASE_URL;
      this.model = opts.model ?? DEFAULT_MODEL;
    } else if (opts.openrouterApiKey) {
      this.provider = "openrouter";
      this.apiKey = opts.openrouterApiKey;
      this.baseUrl = OPENROUTER_BASE_URL;
      // OpenRouter requires the full model path
      this.model = opts.model ?? `perplexity/${DEFAULT_MODEL}`;
    } else {
      throw new Error("WebAnswerTool requires either perplexityApiKey or openrouterApiKey");
    }

    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.cache = new SearchCache();
    this.limiter = new RateLimiter({ maxTokens: 2, refillPerSecond: 0.5 });
  }

  async answer(query: string, opts: AnswerOptions = {}): Promise<string> {
    try {
      const searchLang = this.normalizeLang(opts.searchLang);

      // Check cache (skip for time-sensitive queries)
      if (!isTimeSensitive(query)) {
        const cacheKey = buildCacheKey("web_answer", this.provider, query, {
          searchLang,
          model: this.model,
        });
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;
      }

      if (!this.limiter.acquire()) {
        return "Error: Rate limited — too many answer requests in a short period. Please wait a moment and try again.";
      }

      const result = await this.callPerplexity(query, searchLang);

      // Cache successful results
      if (!result.startsWith("Error:") && !isTimeSensitive(query)) {
        const cacheKey = buildCacheKey("web_answer", this.provider, query, {
          searchLang,
          model: this.model,
        });
        this.cache.set(cacheKey, result, this.cacheTtlMs);
      }

      return result;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        return `Error: Request timed out after ${this.timeoutMs}ms. The answer service may be slow — try again.`;
      }
      return `Error: Unexpected failure during web answer — ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async callPerplexity(query: string, searchLang?: string): Promise<string> {
    const systemContent = searchLang
      ? `Provide a concise, factual answer with citations. Respond in ${searchLang} if appropriate.`
      : "Provide a concise, factual answer with citations.";

    const body = {
      model: this.model,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: query },
      ],
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.provider === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/maziarzamani/spaceduck";
      headers["X-Title"] = "Spaceduck";
    }

    const response = await globalThis.fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const keyType = this.provider === "perplexity-direct" ? "PERPLEXITY_API_KEY" : "OPENROUTER_API_KEY";
        return `Error: Authentication failed (HTTP ${response.status}). Check your ${keyType}.`;
      }
      if (response.status === 429) {
        return "Error: Answer provider rate limit exceeded. Please wait and try again.";
      }
      return `Error: Answer provider returned HTTP ${response.status} ${response.statusText}`;
    }

    const data = await response.json();
    return this.formatAnswer(query, data);
  }

  private formatAnswer(query: string, data: Record<string, unknown>): string {
    const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;
    const content = (message?.content as string) ?? "";

    if (!content) {
      return `Web answer for: "${query}"\nProvider: ${this.provider}\n\nError: No answer content returned by provider.`;
    }

    // Parse citations -- Perplexity returns them in different places depending on API version
    const citations = this.extractCitations(data, message);

    let out = `Web answer for: "${query}"\nProvider: ${this.provider}\n\n`;
    out += `ANSWER:\n${content}\n`;

    if (citations.length > 0) {
      out += "\nSOURCES:\n";
      for (let i = 0; i < citations.length; i++) {
        const c = citations[i];
        out += c.title ? `${i + 1}) ${c.title} - ${c.url}\n` : `${i + 1}) ${c.url}\n`;
      }
    } else {
      out += "\nNOTES:\n";
      out += "- Citations were not returned by the provider for this request.";
      if (this.provider === "openrouter") {
        out += " This can happen when routing through OpenRouter or other OpenAI-compatible proxies.";
      }
      out += "\n- Use web_search to find and verify sources manually.";
    }

    return out.trimEnd();
  }

  /**
   * Extract citations from the Perplexity response.
   * Handles multiple formats:
   * - Top-level `citations` array (Perplexity native, newer API)
   * - `message.citations` array
   * - `message.context` with URLs
   */
  private extractCitations(
    data: Record<string, unknown>,
    message: Record<string, unknown> | undefined,
  ): PerplexityCitation[] {
    // Try top-level citations (Perplexity Sonar native format)
    const topCitations = data.citations;
    if (Array.isArray(topCitations) && topCitations.length > 0) {
      return topCitations.map((c: unknown) => {
        if (typeof c === "string") return { url: c };
        if (typeof c === "object" && c !== null) {
          const obj = c as Record<string, unknown>;
          return { url: String(obj.url ?? obj.link ?? c), title: obj.title as string | undefined };
        }
        return { url: String(c) };
      });
    }

    // Try message-level citations
    const msgCitations = message?.citations;
    if (Array.isArray(msgCitations) && msgCitations.length > 0) {
      return msgCitations.map((c: unknown) => {
        if (typeof c === "string") return { url: c };
        if (typeof c === "object" && c !== null) {
          const obj = c as Record<string, unknown>;
          return { url: String(obj.url ?? obj.link ?? c), title: obj.title as string | undefined };
        }
        return { url: String(c) };
      });
    }

    return [];
  }

  private normalizeLang(lang?: string): string | undefined {
    if (!lang) return undefined;
    if (lang.includes("-")) return lang.split("-")[0].toLowerCase();
    return lang.toLowerCase();
  }
}
