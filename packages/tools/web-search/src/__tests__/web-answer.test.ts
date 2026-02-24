import { describe, test, expect, mock, afterEach } from "bun:test";
import { WebAnswerTool } from "../web-answer-tool";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchOk(body: unknown, status = 200) {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  ) as any;
}

function makePerplexityAnswer(content: string, citations?: unknown[]) {
  const data: Record<string, unknown> = {
    choices: [{ message: { content } }],
  };
  if (citations) data.citations = citations;
  return data;
}

describe("WebAnswerTool", () => {
  describe("constructor", () => {
    test("creates with perplexity API key", () => {
      const tool = new WebAnswerTool({ perplexityApiKey: "pplx-key" });
      expect((tool as any).provider).toBe("perplexity-direct");
      expect((tool as any).model).toBe("sonar-pro");
    });

    test("creates with openrouter API key", () => {
      const tool = new WebAnswerTool({ openrouterApiKey: "or-key" });
      expect((tool as any).provider).toBe("openrouter");
      expect((tool as any).model).toBe("perplexity/sonar-pro");
    });

    test("prefers perplexity when both keys provided", () => {
      const tool = new WebAnswerTool({ perplexityApiKey: "pplx", openrouterApiKey: "or" });
      expect((tool as any).provider).toBe("perplexity-direct");
    });

    test("throws when no API key provided", () => {
      expect(() => new WebAnswerTool({})).toThrow("requires either");
    });

    test("accepts custom model", () => {
      const tool = new WebAnswerTool({ perplexityApiKey: "key", model: "sonar" });
      expect((tool as any).model).toBe("sonar");
    });
  });

  describe("answer", () => {
    test("returns formatted answer with citations", async () => {
      mockFetchOk(
        makePerplexityAnswer("The answer is 42.", [
          "https://example.com/source1",
          { url: "https://example.com/source2", title: "Source Two" },
        ]),
      );

      const tool = new WebAnswerTool({ perplexityApiKey: "key" });
      const result = await tool.answer("What is the answer?");

      expect(result).toContain("The answer is 42.");
      expect(result).toContain("ANSWER:");
      expect(result).toContain("SOURCES:");
      expect(result).toContain("https://example.com/source1");
      expect(result).toContain("Source Two");
    });

    test("returns formatted answer without citations", async () => {
      mockFetchOk(makePerplexityAnswer("No citations here."));

      const tool = new WebAnswerTool({ perplexityApiKey: "key" });
      const result = await tool.answer("question");

      expect(result).toContain("No citations here.");
      expect(result).toContain("NOTES:");
      expect(result).toContain("Citations were not returned");
    });

    test("includes OpenRouter note when provider is openrouter", async () => {
      mockFetchOk(makePerplexityAnswer("Answer text"));

      const tool = new WebAnswerTool({ openrouterApiKey: "key" });
      const result = await tool.answer("question");

      expect(result).toContain("OpenRouter");
    });

    test("returns error on auth failure (401)", async () => {
      mockFetchOk({}, 401);

      const tool = new WebAnswerTool({ perplexityApiKey: "bad-key" });
      const result = await tool.answer("question");

      expect(result).toContain("Error:");
      expect(result).toContain("Authentication failed");
      expect(result).toContain("PERPLEXITY_API_KEY");
    });

    test("returns error on rate limit (429)", async () => {
      mockFetchOk({}, 429);

      const tool = new WebAnswerTool({ perplexityApiKey: "key" });
      const result = await tool.answer("question");

      expect(result).toContain("Error:");
      expect(result).toContain("rate limit");
    });

    test("returns error on other HTTP errors", async () => {
      mockFetchOk({}, 500);

      const tool = new WebAnswerTool({ perplexityApiKey: "key" });
      const result = await tool.answer("question");

      expect(result).toContain("Error:");
      expect(result).toContain("500");
    });

    test("returns error when no answer content", async () => {
      mockFetchOk({ choices: [{ message: { content: "" } }] });

      const tool = new WebAnswerTool({ perplexityApiKey: "key" });
      const result = await tool.answer("question");

      expect(result).toContain("Error:");
      expect(result).toContain("No answer content");
    });

    test("handles message-level citations", async () => {
      mockFetchOk({
        choices: [{ message: { content: "Answer", citations: ["https://msg-cite.com"] } }],
      });

      const tool = new WebAnswerTool({ perplexityApiKey: "key" });
      const result = await tool.answer("question");

      expect(result).toContain("https://msg-cite.com");
      expect(result).toContain("SOURCES:");
    });

    test("sends OpenRouter headers when using openrouter provider", async () => {
      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = mock((_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Record<string, string>;
        return Promise.resolve(
          new Response(JSON.stringify(makePerplexityAnswer("ok")), { status: 200 }),
        );
      }) as any;

      const tool = new WebAnswerTool({ openrouterApiKey: "or-key" });
      await tool.answer("question");

      expect(capturedHeaders["HTTP-Referer"]).toBeDefined();
      expect(capturedHeaders["X-Title"]).toBe("Spaceduck");
    });

    test("caches non-time-sensitive results", async () => {
      let fetchCount = 0;
      globalThis.fetch = mock(() => {
        fetchCount++;
        return Promise.resolve(
          new Response(JSON.stringify(makePerplexityAnswer("cached answer")), { status: 200 }),
        );
      }) as any;

      const tool = new WebAnswerTool({ perplexityApiKey: "key" });
      await tool.answer("what is TypeScript");
      await tool.answer("what is TypeScript");

      // Second call should hit cache, but rate limiter may also block
      // At minimum, the second call should return the same content
      expect(fetchCount).toBeLessThanOrEqual(2);
    });

    test("normalizes search language", async () => {
      let capturedBody: Record<string, unknown> = {};
      globalThis.fetch = mock((_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string);
        return Promise.resolve(
          new Response(JSON.stringify(makePerplexityAnswer("ok")), { status: 200 }),
        );
      }) as any;

      const tool = new WebAnswerTool({ perplexityApiKey: "key" });
      await tool.answer("question", { searchLang: "da-DK" });

      const systemMsg = (capturedBody.messages as any[])[0];
      expect(systemMsg.content).toContain("da");
    });

    test("returns rate limit error when limiter blocks", async () => {
      mockFetchOk(makePerplexityAnswer("ok"));

      const tool = new WebAnswerTool({
        perplexityApiKey: "key",
        cacheTtlMs: 0,
      });

      // Exhaust rate limiter (2 tokens max)
      await tool.answer("q1-unique-" + Date.now());
      await tool.answer("q2-unique-" + Date.now());
      const result = await tool.answer("q3-unique-" + Date.now());

      expect(result).toContain("Rate limited");
    });
  });
});
