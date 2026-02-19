import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { WebSearchTool } from "../web-search-tool";
import { WebAnswerTool } from "../web-answer-tool";
import { SearchCache, buildCacheKey, isTimeSensitive } from "../cache";
import { RateLimiter } from "../rate-limiter";

// ═══════════════════════════════════════════════════════════════════════
// Helper: mock globalThis.fetch
// ═══════════════════════════════════════════════════════════════════════

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = handler as typeof globalThis.fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function jsonResponse(data: unknown, status = 200, statusText = "OK"): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

// ═══════════════════════════════════════════════════════════════════════
// SearchCache
// ═══════════════════════════════════════════════════════════════════════

describe("SearchCache", () => {
  it("should return undefined for missing keys", () => {
    const cache = new SearchCache();
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.has("missing")).toBe(false);
  });

  it("should store and retrieve values", () => {
    const cache = new SearchCache();
    cache.set("key1", "value1", 60_000);
    expect(cache.get("key1")).toBe("value1");
    expect(cache.has("key1")).toBe(true);
    expect(cache.size).toBe(1);
  });

  it("should expire entries after TTL", async () => {
    const cache = new SearchCache();
    cache.set("key1", "value1", 50);
    expect(cache.get("key1")).toBe("value1");

    await Bun.sleep(60);
    expect(cache.get("key1")).toBeUndefined();
    expect(cache.has("key1")).toBe(false);
  });

  it("should evict oldest entries when at max capacity", () => {
    const cache = new SearchCache(3);
    cache.set("a", "1", 60_000);
    cache.set("b", "2", 60_000);
    cache.set("c", "3", 60_000);
    expect(cache.size).toBe(3);

    cache.set("d", "4", 60_000);
    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined(); // evicted (oldest)
    expect(cache.get("d")).toBe("4");
  });

  it("should update LRU order on access", () => {
    const cache = new SearchCache(3);
    cache.set("a", "1", 60_000);
    cache.set("b", "2", 60_000);
    cache.set("c", "3", 60_000);

    // Access "a" to make it most recently used
    cache.get("a");

    // Add "d" — should evict "b" (now oldest), not "a"
    cache.set("d", "4", 60_000);
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeUndefined();
  });

  it("should clear all entries", () => {
    const cache = new SearchCache();
    cache.set("a", "1", 60_000);
    cache.set("b", "2", 60_000);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe("buildCacheKey", () => {
  it("should include all dimensions", () => {
    const key = buildCacheKey("web_search", "brave", "test query", {
      freshness: "pw",
      country: "DK",
      searchLang: "da",
    });
    expect(key).toContain("web_search");
    expect(key).toContain("brave");
    expect(key).toContain("test query");
    expect(key).toContain("pw");
    expect(key).toContain("DK");
    expect(key).toContain("da");
  });

  it("should normalize query to lowercase", () => {
    const k1 = buildCacheKey("web_search", "brave", "Hello World", {});
    const k2 = buildCacheKey("web_search", "brave", "hello world", {});
    expect(k1).toBe(k2);
  });

  it("should produce different keys for different providers", () => {
    const k1 = buildCacheKey("web_search", "brave", "test", {});
    const k2 = buildCacheKey("web_search", "searxng", "test", {});
    expect(k1).not.toBe(k2);
  });

  it("should produce different keys for different languages", () => {
    const k1 = buildCacheKey("web_search", "brave", "test", { searchLang: "da" });
    const k2 = buildCacheKey("web_search", "brave", "test", { searchLang: "en" });
    expect(k1).not.toBe(k2);
  });
});

describe("isTimeSensitive", () => {
  it("should detect 'today'", () => {
    expect(isTimeSensitive("what happened today")).toBe(true);
  });

  it("should detect 'latest'", () => {
    expect(isTimeSensitive("latest news on AI")).toBe(true);
  });

  it("should detect 'breaking'", () => {
    expect(isTimeSensitive("breaking news")).toBe(true);
  });

  it("should detect ISO date patterns", () => {
    expect(isTimeSensitive("events on 2026-02-17")).toBe(true);
  });

  it("should detect 'right now'", () => {
    expect(isTimeSensitive("what's happening right now")).toBe(true);
  });

  it("should return false for non-time-sensitive queries", () => {
    expect(isTimeSensitive("how to make pasta")).toBe(false);
    expect(isTimeSensitive("TypeScript generics tutorial")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// RateLimiter
// ═══════════════════════════════════════════════════════════════════════

describe("RateLimiter", () => {
  it("should allow requests up to burst limit", () => {
    const limiter = new RateLimiter({ maxTokens: 3, refillPerSecond: 1 });
    expect(limiter.acquire()).toBe(true);
    expect(limiter.acquire()).toBe(true);
    expect(limiter.acquire()).toBe(true);
    expect(limiter.acquire()).toBe(false);
  });

  it("should refill tokens over time", async () => {
    const limiter = new RateLimiter({ maxTokens: 2, refillPerSecond: 10 });
    limiter.acquire();
    limiter.acquire();
    expect(limiter.acquire()).toBe(false);

    await Bun.sleep(150);
    expect(limiter.acquire()).toBe(true);
  });

  it("should not exceed max tokens", async () => {
    const limiter = new RateLimiter({ maxTokens: 2, refillPerSecond: 100 });
    await Bun.sleep(100);
    // Even after long time, should only have maxTokens
    expect(limiter.acquire()).toBe(true);
    expect(limiter.acquire()).toBe(true);
    expect(limiter.acquire()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// WebSearchTool — Brave
// ═══════════════════════════════════════════════════════════════════════

describe("WebSearchTool — Brave", () => {
  afterEach(restoreFetch);

  const makeTool = () =>
    new WebSearchTool({
      provider: "brave",
      braveApiKey: "test-key-123",
    });

  it("should format Brave results correctly", async () => {
    mockFetch(() =>
      jsonResponse({
        web: {
          results: [
            {
              title: "Bun — fast runtime",
              url: "https://bun.sh",
              description: "Bun is a fast all-in-one JavaScript runtime.",
              page_age: "2026-01-15",
            },
            {
              title: "Deno — secure runtime",
              url: "https://deno.land",
              description: "Deno is a secure runtime for JavaScript.",
            },
          ],
        },
      }),
    );

    const tool = makeTool();
    const result = await tool.search("javascript runtime");

    expect(result).toContain('Web search results for: "javascript runtime"');
    expect(result).toContain("Provider: brave");
    expect(result).toContain("1) Bun — fast runtime");
    expect(result).toContain("URL: https://bun.sh");
    expect(result).toContain("Published: 2026-01-15");
    expect(result).toContain("Snippet: Bun is a fast all-in-one JavaScript runtime.");
    expect(result).toContain("2) Deno — secure runtime");
    expect(result).toContain("URL: https://deno.land");
  });

  it("should pass correct headers and params to Brave API", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};

    mockFetch((url, init) => {
      capturedUrl = url;
      capturedHeaders = Object.fromEntries(
        Object.entries(init?.headers ?? {}),
      );
      return jsonResponse({ web: { results: [] } });
    });

    const tool = makeTool();
    await tool.search("test query", {
      count: 3,
      freshness: "pw",
      country: "DK",
      searchLang: "da",
    });

    expect(capturedUrl).toContain("api.search.brave.com");
    expect(capturedUrl).toContain("q=test+query");
    expect(capturedUrl).toContain("count=3");
    expect(capturedUrl).toContain("freshness=pw");
    expect(capturedUrl).toContain("country=DK");
    expect(capturedUrl).toContain("search_lang=da");
    expect(capturedHeaders["X-Subscription-Token"]).toBe("test-key-123");
  });

  it("should handle 401 (bad API key)", async () => {
    mockFetch(() => jsonResponse({ error: "unauthorized" }, 401, "Unauthorized"));

    const tool = makeTool();
    const result = await tool.search("test");

    expect(result).toContain("Error:");
    expect(result).toContain("authentication failed");
    expect(result).toContain("BRAVE_API_KEY");
  });

  it("should handle 429 (rate limit)", async () => {
    mockFetch(() => jsonResponse({}, 429, "Too Many Requests"));

    const tool = makeTool();
    const result = await tool.search("test");

    expect(result).toContain("Error:");
    expect(result).toContain("rate limit");
  });

  it("should handle empty results", async () => {
    mockFetch(() => jsonResponse({ web: { results: [] } }));

    const tool = makeTool();
    const result = await tool.search("obscure query with no results");

    expect(result).toContain("No results found");
  });

  it("should handle network errors", async () => {
    mockFetch(() => {
      throw new TypeError("fetch failed");
    });

    const tool = makeTool();
    const result = await tool.search("test");

    expect(result).toContain("Error:");
  });

  it("should return error if no API key configured", async () => {
    const tool = new WebSearchTool({ provider: "brave" });
    const result = await tool.search("test");

    expect(result).toContain("Error:");
    expect(result).toContain("BRAVE_API_KEY");
  });

  it("should include params metadata in output", async () => {
    mockFetch(() =>
      jsonResponse({
        web: { results: [{ title: "Test", url: "https://test.com", description: "test" }] },
      }),
    );

    const tool = makeTool();
    const result = await tool.search("test", { count: 3, freshness: "pd", country: "US" });

    expect(result).toContain("count=3");
    expect(result).toContain("freshness=pd");
    expect(result).toContain("country=US");
  });

  it("should normalize locale (da-DK -> da + DK)", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ web: { results: [] } });
    });

    const tool = makeTool();
    await tool.search("test", { searchLang: "da-DK" });

    expect(capturedUrl).toContain("search_lang=da");
    expect(capturedUrl).toContain("country=DK");
  });

  it("should cache results and serve from cache on repeat query", async () => {
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      return jsonResponse({
        web: { results: [{ title: "Cached", url: "https://cache.com", description: "cached" }] },
      });
    });

    const tool = makeTool();
    const r1 = await tool.search("cache test");
    const r2 = await tool.search("cache test");

    expect(callCount).toBe(1);
    expect(r1).toBe(r2);
  });

  it("should bypass cache for time-sensitive queries", async () => {
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      return jsonResponse({
        web: { results: [{ title: "News", url: "https://news.com", description: "news" }] },
      });
    });

    const tool = makeTool();
    await tool.search("latest news today");
    await tool.search("latest news today");

    expect(callCount).toBe(2);
  });

  it("should rate limit bursty requests", async () => {
    mockFetch(() =>
      jsonResponse({
        web: { results: [{ title: "T", url: "https://t.com", description: "t" }] },
      }),
    );

    const tool = makeTool();
    // Burst of 4 requests — should hit rate limit on 4th (burst=3 for brave)
    const results = await Promise.all([
      tool.search("q1"),
      tool.search("q2"),
      tool.search("q3"),
      tool.search("q4"),
    ]);

    const rateLimited = results.filter((r) => r.includes("Rate limited"));
    expect(rateLimited.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// WebSearchTool — SearXNG
// ═══════════════════════════════════════════════════════════════════════

describe("WebSearchTool — SearXNG", () => {
  afterEach(restoreFetch);

  const makeTool = () =>
    new WebSearchTool({
      provider: "searxng",
      searxngUrl: "http://localhost:8080",
    });

  it("should format SearXNG results correctly", async () => {
    mockFetch(() =>
      jsonResponse({
        results: [
          {
            title: "SearXNG Docs",
            url: "https://docs.searxng.org",
            content: "Privacy-respecting search engine.",
            publishedDate: "2025-12-01",
          },
        ],
      }),
    );

    const tool = makeTool();
    const result = await tool.search("searxng docs");

    expect(result).toContain('Web search results for: "searxng docs"');
    expect(result).toContain("Provider: searxng");
    expect(result).toContain("1) SearXNG Docs");
    expect(result).toContain("URL: https://docs.searxng.org");
    expect(result).toContain("Published: 2025-12-01");
    expect(result).toContain("Snippet: Privacy-respecting search engine.");
  });

  it("should return actionable 403 error message", async () => {
    mockFetch(() => new Response("Forbidden", { status: 403, statusText: "Forbidden" }));

    const tool = makeTool();
    const result = await tool.search("test");

    expect(result).toContain("Error: SearXNG returned 403 Forbidden");
    expect(result).toContain("settings.yml");
    expect(result).toContain("formats:");
    expect(result).toContain("- html");
    expect(result).toContain("- json");
    expect(result).toContain("docs.searxng.org");
  });

  it("should handle generic HTTP errors", async () => {
    mockFetch(() => new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }));

    const tool = makeTool();
    const result = await tool.search("test");

    expect(result).toContain("Error:");
    expect(result).toContain("500");
  });

  it("should return error if no URL configured", async () => {
    const tool = new WebSearchTool({ provider: "searxng" });
    const result = await tool.search("test");

    expect(result).toContain("Error:");
    expect(result).toContain("SEARXNG_URL");
  });

  it("should pass language param to SearXNG", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ results: [] });
    });

    const tool = makeTool();
    await tool.search("test", { searchLang: "da" });

    expect(capturedUrl).toContain("language=da");
  });

  it("should use custom user agent when configured", async () => {
    let capturedHeaders: Record<string, string> = {};
    mockFetch((_url, init) => {
      capturedHeaders = Object.fromEntries(Object.entries(init?.headers ?? {}));
      return jsonResponse({ results: [] });
    });

    const tool = new WebSearchTool({
      provider: "searxng",
      searxngUrl: "http://localhost:8080",
      searxngUserAgent: "MyCustomBot/1.0",
    });
    await tool.search("test");

    expect(capturedHeaders["User-Agent"]).toBe("MyCustomBot/1.0");
  });

  it("should strip trailing slash from URL", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ results: [] });
    });

    const tool = new WebSearchTool({
      provider: "searxng",
      searxngUrl: "http://localhost:8080/",
    });
    await tool.search("test");

    expect(capturedUrl).toStartWith("http://localhost:8080/search?");
    expect(capturedUrl).not.toContain("//search");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// WebAnswerTool — Perplexity Direct
// ═══════════════════════════════════════════════════════════════════════

describe("WebAnswerTool — Perplexity Direct", () => {
  afterEach(restoreFetch);

  const makeTool = () =>
    new WebAnswerTool({ perplexityApiKey: "pplx-test-key" });

  it("should format answer with citations correctly", async () => {
    mockFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: "TypeScript is a typed superset of JavaScript.",
            },
          },
        ],
        citations: [
          "https://www.typescriptlang.org",
          "https://en.wikipedia.org/wiki/TypeScript",
        ],
      }),
    );

    const tool = makeTool();
    const result = await tool.answer("What is TypeScript?");

    expect(result).toContain('Web answer for: "What is TypeScript?"');
    expect(result).toContain("Provider: perplexity-direct");
    expect(result).toContain("ANSWER:");
    expect(result).toContain("TypeScript is a typed superset of JavaScript.");
    expect(result).toContain("SOURCES:");
    expect(result).toContain("1) https://www.typescriptlang.org");
    expect(result).toContain("2) https://en.wikipedia.org/wiki/TypeScript");
    expect(result).not.toContain("NOTES:");
  });

  it("should handle citations with titles", async () => {
    mockFetch(() =>
      jsonResponse({
        choices: [{ message: { content: "Answer text." } }],
        citations: [
          { url: "https://example.com", title: "Example Site" },
        ],
      }),
    );

    const tool = makeTool();
    const result = await tool.answer("test");

    expect(result).toContain("1) Example Site - https://example.com");
  });

  it("should handle message-level citations", async () => {
    mockFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: "Answer here.",
              citations: ["https://source1.com", "https://source2.com"],
            },
          },
        ],
      }),
    );

    const tool = makeTool();
    const result = await tool.answer("test");

    expect(result).toContain("SOURCES:");
    expect(result).toContain("https://source1.com");
    expect(result).toContain("https://source2.com");
  });

  it("should show warning when no citations returned", async () => {
    mockFetch(() =>
      jsonResponse({
        choices: [{ message: { content: "Some answer without citations." } }],
      }),
    );

    const tool = makeTool();
    const result = await tool.answer("test");

    expect(result).toContain("NOTES:");
    expect(result).toContain("Citations were not returned");
    expect(result).toContain("web_search to find and verify");
    expect(result).not.toContain("OpenRouter"); // Direct API, no proxy warning
  });

  it("should pass correct headers for direct Perplexity API", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};

    mockFetch((url, init) => {
      capturedUrl = url;
      capturedHeaders = Object.fromEntries(Object.entries(init?.headers ?? {}));
      return jsonResponse({ choices: [{ message: { content: "test" } }] });
    });

    const tool = makeTool();
    await tool.answer("test");

    expect(capturedUrl).toContain("api.perplexity.ai/chat/completions");
    expect(capturedHeaders["Authorization"]).toBe("Bearer pplx-test-key");
    expect(capturedHeaders["HTTP-Referer"]).toBeUndefined();
  });

  it("should use default model sonar-pro", async () => {
    let capturedBody = "";
    mockFetch((_url, init) => {
      capturedBody = init?.body as string;
      return jsonResponse({ choices: [{ message: { content: "test" } }] });
    });

    const tool = makeTool();
    await tool.answer("test");

    const body = JSON.parse(capturedBody);
    expect(body.model).toBe("sonar-pro");
  });

  it("should handle 401 with helpful error", async () => {
    mockFetch(() => jsonResponse({ error: "unauthorized" }, 401, "Unauthorized"));

    const tool = makeTool();
    const result = await tool.answer("test");

    expect(result).toContain("Error:");
    expect(result).toContain("Authentication failed");
    expect(result).toContain("PERPLEXITY_API_KEY");
  });

  it("should handle 429 rate limit", async () => {
    mockFetch(() => jsonResponse({}, 429, "Too Many Requests"));

    const tool = makeTool();
    const result = await tool.answer("test");

    expect(result).toContain("Error:");
    expect(result).toContain("rate limit");
  });

  it("should handle empty response content", async () => {
    mockFetch(() => jsonResponse({ choices: [{ message: { content: "" } }] }));

    const tool = makeTool();
    const result = await tool.answer("test");

    expect(result).toContain("Error: No answer content");
  });

  it("should include language in system prompt when searchLang provided", async () => {
    let capturedBody = "";
    mockFetch((_url, init) => {
      capturedBody = init?.body as string;
      return jsonResponse({ choices: [{ message: { content: "test" } }] });
    });

    const tool = makeTool();
    await tool.answer("test", { searchLang: "da" });

    const body = JSON.parse(capturedBody);
    expect(body.messages[0].content).toContain("da");
  });

  it("should cache answers and serve from cache", async () => {
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      return jsonResponse({
        choices: [{ message: { content: "cached answer" } }],
        citations: ["https://source.com"],
      });
    });

    const tool = makeTool();
    const r1 = await tool.answer("cache test");
    const r2 = await tool.answer("cache test");

    expect(callCount).toBe(1);
    expect(r1).toBe(r2);
  });

  it("should bypass cache for time-sensitive queries", async () => {
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      return jsonResponse({
        choices: [{ message: { content: "answer" } }],
      });
    });

    const tool = makeTool();
    await tool.answer("what happened today");
    await tool.answer("what happened today");

    expect(callCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// WebAnswerTool — OpenRouter fallback
// ═══════════════════════════════════════════════════════════════════════

describe("WebAnswerTool — OpenRouter fallback", () => {
  afterEach(restoreFetch);

  const makeTool = () =>
    new WebAnswerTool({ openrouterApiKey: "sk-or-test-key" });

  it("should use OpenRouter base URL and model prefix", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    mockFetch((url, init) => {
      capturedUrl = url;
      capturedBody = init?.body as string;
      return jsonResponse({ choices: [{ message: { content: "test" } }] });
    });

    const tool = makeTool();
    await tool.answer("test");

    expect(capturedUrl).toContain("openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(capturedBody);
    expect(body.model).toBe("perplexity/sonar-pro");
  });

  it("should include OpenRouter-specific headers", async () => {
    let capturedHeaders: Record<string, string> = {};

    mockFetch((_url, init) => {
      capturedHeaders = Object.fromEntries(Object.entries(init?.headers ?? {}));
      return jsonResponse({ choices: [{ message: { content: "test" } }] });
    });

    const tool = makeTool();
    await tool.answer("test");

    expect(capturedHeaders["Authorization"]).toBe("Bearer sk-or-test-key");
    expect(capturedHeaders["HTTP-Referer"]).toContain("spaceduck");
    expect(capturedHeaders["X-Title"]).toBe("Spaceduck");
  });

  it("should show OpenRouter-specific warning when citations missing", async () => {
    mockFetch(() =>
      jsonResponse({
        choices: [{ message: { content: "Answer without citations." } }],
      }),
    );

    const tool = makeTool();
    const result = await tool.answer("test");

    expect(result).toContain("Provider: openrouter");
    expect(result).toContain("NOTES:");
    expect(result).toContain("OpenRouter");
    expect(result).toContain("OpenAI-compatible proxies");
    expect(result).toContain("web_search");
  });

  it("should handle 401 with OpenRouter key reference", async () => {
    mockFetch(() => jsonResponse({}, 401, "Unauthorized"));

    const tool = makeTool();
    const result = await tool.answer("test");

    expect(result).toContain("OPENROUTER_API_KEY");
  });

  it("should throw if neither key is provided", () => {
    expect(() => new WebAnswerTool({})).toThrow("requires either perplexityApiKey or openrouterApiKey");
  });

  it("should prefer Perplexity direct when both keys are provided", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ choices: [{ message: { content: "test" } }] });
    });

    const tool = new WebAnswerTool({
      perplexityApiKey: "pplx-key",
      openrouterApiKey: "sk-or-key",
    });
    await tool.answer("test");

    expect(capturedUrl).toContain("api.perplexity.ai");
    expect(capturedUrl).not.toContain("openrouter");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Param mapping / locale normalization
// ═══════════════════════════════════════════════════════════════════════

describe("Locale normalization", () => {
  afterEach(restoreFetch);

  it("should split da-DK into searchLang=da and country=DK", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ web: { results: [] } });
    });

    const tool = new WebSearchTool({
      provider: "brave",
      braveApiKey: "test-key",
    });
    await tool.search("test", { searchLang: "da-DK" });

    expect(capturedUrl).toContain("search_lang=da");
    expect(capturedUrl).toContain("country=DK");
  });

  it("should not override explicit country when splitting locale", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ web: { results: [] } });
    });

    const tool = new WebSearchTool({
      provider: "brave",
      braveApiKey: "test-key",
    });
    await tool.search("test", { searchLang: "da-DK", country: "US" });

    expect(capturedUrl).toContain("country=US");
    expect(capturedUrl).toContain("search_lang=da");
  });

  it("should uppercase country codes", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ web: { results: [] } });
    });

    const tool = new WebSearchTool({
      provider: "brave",
      braveApiKey: "test-key",
    });
    await tool.search("test", { country: "dk" });

    expect(capturedUrl).toContain("country=DK");
  });

  it("should lowercase language codes", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ web: { results: [] } });
    });

    const tool = new WebSearchTool({
      provider: "brave",
      braveApiKey: "test-key",
    });
    await tool.search("test", { searchLang: "DA" });

    expect(capturedUrl).toContain("search_lang=da");
  });

  it("should normalize searchLang for web_answer (da-DK -> da)", async () => {
    let capturedBody = "";
    mockFetch((_url, init) => {
      capturedBody = init?.body as string;
      return jsonResponse({ choices: [{ message: { content: "test" } }] });
    });

    const tool = new WebAnswerTool({ perplexityApiKey: "pplx-test" });
    await tool.answer("test", { searchLang: "da-DK" });

    const body = JSON.parse(capturedBody);
    expect(body.messages[0].content).toContain("da");
    expect(body.messages[0].content).not.toContain("da-DK");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration tests (skipped without API keys)
// ═══════════════════════════════════════════════════════════════════════

const BRAVE_KEY = process.env.BRAVE_API_KEY;
const PPLX_KEY = process.env.PERPLEXITY_API_KEY;
const OR_KEY = process.env.OPENROUTER_API_KEY;
const SEARXNG = process.env.SEARXNG_URL;

describe("Integration: Brave", () => {
  const shouldRun = !!BRAVE_KEY;

  it.skipIf(!shouldRun)("should return real search results", async () => {
    const tool = new WebSearchTool({
      provider: "brave",
      braveApiKey: BRAVE_KEY!,
    });
    const result = await tool.search("Bun JavaScript runtime", { count: 3 });

    expect(result).toContain("Web search results for:");
    expect(result).toContain("Provider: brave");
    expect(result).toContain("URL:");
  });
});

describe("Integration: SearXNG", () => {
  const shouldRun = !!SEARXNG;

  it.skipIf(!shouldRun)("should return real search results", async () => {
    const tool = new WebSearchTool({
      provider: "searxng",
      searxngUrl: SEARXNG!,
    });
    const result = await tool.search("TypeScript");

    expect(result).toContain("Web search results for:");
    expect(result).toContain("Provider: searxng");
  });
});

describe("Integration: Perplexity Direct", () => {
  const shouldRun = !!PPLX_KEY;

  it.skipIf(!shouldRun)("should return real answer with citations", async () => {
    const tool = new WebAnswerTool({ perplexityApiKey: PPLX_KEY! });
    const result = await tool.answer("What is Bun.sh?");

    expect(result).toContain("Web answer for:");
    expect(result).toContain("Provider: perplexity-direct");
    expect(result).toContain("ANSWER:");
  });
});

describe("Integration: Perplexity via OpenRouter", () => {
  const shouldRun = !!OR_KEY;

  it.skipIf(!shouldRun)("should return real answer or billing error", async () => {
    const tool = new WebAnswerTool({ openrouterApiKey: OR_KEY! });
    const result = await tool.answer("What is TypeScript?");

    // Either a successful answer or a billing/auth error (402 = no credits, 401 = bad key)
    const isAnswer = result.includes("Web answer for:");
    const isExpectedError = result.includes("Error:") && (result.includes("402") || result.includes("401"));
    expect(isAnswer || isExpectedError).toBe(true);
  });
});
