import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { OpenAICompatibleProvider } from "../provider";
import { ProviderError } from "@spaceduck/core";

function makeProvider(baseUrl: string, opts: Record<string, unknown> = {}) {
  return new OpenAICompatibleProvider({ name: "test", baseUrl, model: null, ...opts });
}

/** Build a fake SSE streaming Response from an array of SSE lines. */
function sseResponse(lines: string[], status = 200): Response {
  const body = lines.join("\n") + "\n";
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

function sseTextChunk(text: string): string {
  return `data: ${JSON.stringify({
    choices: [{ delta: { content: text }, finish_reason: null }],
  })}`;
}

function sseToolDelta(index: number, id?: string, name?: string, args?: string): string {
  const tc: Record<string, unknown> = { index };
  const fn: Record<string, unknown> = {};
  if (id) tc.id = id;
  if (name) fn.name = name;
  if (args !== undefined) fn.arguments = args;
  if (Object.keys(fn).length) tc.function = fn;
  return `data: ${JSON.stringify({
    choices: [{ delta: { tool_calls: [tc] }, finish_reason: null }],
  })}`;
}

function sseFinish(reason: string): string {
  return `data: ${JSON.stringify({
    choices: [{ delta: {}, finish_reason: reason }],
  })}`;
}

const sseDone = "data: [DONE]";

describe("OpenAICompatibleProvider baseUrl normalization", () => {
  test("appends /v1 when missing", () => {
    const p = makeProvider("http://127.0.0.1:8080");
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  test("keeps /v1 when already present", () => {
    const p = makeProvider("http://127.0.0.1:8080/v1");
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  test("strips trailing slash then keeps /v1", () => {
    const p = makeProvider("http://127.0.0.1:8080/v1/");
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  test("strips full chat/completions endpoint", () => {
    const p = makeProvider("http://127.0.0.1:8080/v1/chat/completions");
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  test("handles multiple trailing slashes", () => {
    const p = makeProvider("http://127.0.0.1:8080/v1///");
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });
});

describe("OpenAICompatibleProvider model handling", () => {
  test("null model is stored as null", () => {
    const p = makeProvider("http://localhost/v1");
    expect((p as any).model).toBeNull();
  });

  test("string model is stored as-is", () => {
    const p = new OpenAICompatibleProvider({ name: "test", baseUrl: "http://localhost/v1", model: "gpt-4" });
    expect((p as any).model).toBe("gpt-4");
  });

  test("undefined model defaults to null", () => {
    const p = new OpenAICompatibleProvider({ name: "test", baseUrl: "http://localhost/v1" });
    expect((p as any).model).toBeNull();
  });
});

describe("OpenAICompatibleProvider config defaults", () => {
  test("stripThinkTags defaults to true", () => {
    const p = makeProvider("http://localhost/v1");
    expect((p as any).stripThinkTags).toBe(true);
  });

  test("toolFallback defaults to error", () => {
    const p = makeProvider("http://localhost/v1");
    expect((p as any).toolFallback).toBe("error");
  });

  test("extraHeaders and extraBody default to empty", () => {
    const p = makeProvider("http://localhost/v1");
    expect((p as any).extraHeaders).toEqual({});
    expect((p as any).extraBody).toEqual({});
  });

  test("apiKey defaults to empty string", () => {
    const p = makeProvider("http://localhost/v1");
    expect((p as any).apiKey).toBe("");
  });
});

describe("OpenAICompatibleProvider.chat streaming", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("yields text chunks from SSE stream", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        sseResponse([sseTextChunk("Hello "), sseTextChunk("world"), sseFinish("stop"), sseDone]),
      ),
    );

    const p = new OpenAICompatibleProvider({
      name: "test",
      baseUrl: "http://localhost/v1",
      model: "m1",
      stripThinkTags: false,
    });

    const chunks: string[] = [];
    for await (const chunk of p.chat([{ role: "user", content: "hi" }])) {
      if (chunk.type === "text") chunks.push(chunk.text);
    }

    expect(chunks).toEqual(["Hello ", "world"]);
  });

  test("yields tool_call chunks from SSE stream", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        sseResponse([
          sseToolDelta(0, "tc1", "web_search", '{"query":'),
          sseToolDelta(0, undefined, undefined, '"test"}'),
          sseFinish("tool_calls"),
          sseDone,
        ]),
      ),
    );

    const p = new OpenAICompatibleProvider({
      name: "test",
      baseUrl: "http://localhost/v1",
      model: "m1",
      stripThinkTags: false,
    });

    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
    for await (const chunk of p.chat([{ role: "user", content: "search" }])) {
      if (chunk.type === "tool_call") toolCalls.push(chunk.toolCall);
    }

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].id).toBe("tc1");
    expect(toolCalls[0].name).toBe("web_search");
    expect(toolCalls[0].args).toEqual({ query: "test" });
  });

  test("throws ProviderError on non-OK response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Server Error", { status: 500 })),
    );

    const p = new OpenAICompatibleProvider({
      name: "testprov",
      baseUrl: "http://localhost/v1",
      model: "m1",
    });

    const iter = p.chat([{ role: "user", content: "hi" }]);
    try {
      for await (const _chunk of iter) {
        /* should not yield */
      }
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).providerCode).toBe("unknown");
    }
  });

  test("throws ProviderError on network failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("fetch failed")));

    const p = new OpenAICompatibleProvider({
      name: "testprov",
      baseUrl: "http://localhost/v1",
      model: "m1",
    });

    const iter = p.chat([{ role: "user", content: "hi" }]);
    try {
      for await (const _chunk of iter) {
        /* should not yield */
      }
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).providerCode).toBe("transient_network");
    }
  });

  test("sends Authorization header when apiKey is set", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve(sseResponse([sseFinish("stop"), sseDone]));
    });

    const p = new OpenAICompatibleProvider({
      name: "test",
      baseUrl: "http://localhost/v1",
      model: "m1",
      apiKey: "sk-test-key",
      stripThinkTags: false,
    });

    for await (const _chunk of p.chat([{ role: "user", content: "hi" }])) {
      /* consume */
    }

    expect(capturedHeaders["Authorization"]).toBe("Bearer sk-test-key");
  });

  test("omits Authorization header when apiKey is empty", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve(sseResponse([sseFinish("stop"), sseDone]));
    });

    const p = new OpenAICompatibleProvider({
      name: "test",
      baseUrl: "http://localhost/v1",
      model: "m1",
      stripThinkTags: false,
    });

    for await (const _chunk of p.chat([{ role: "user", content: "hi" }])) {
      /* consume */
    }

    expect(capturedHeaders["Authorization"]).toBeUndefined();
  });

  test("strips <think> tags from streamed text", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        sseResponse([
          sseTextChunk("<think>reasoning"),
          sseTextChunk("</think>visible text"),
          sseFinish("stop"),
          sseDone,
        ]),
      ),
    );

    const p = new OpenAICompatibleProvider({
      name: "test",
      baseUrl: "http://localhost/v1",
      model: "m1",
      stripThinkTags: true,
    });

    const chunks: string[] = [];
    for await (const chunk of p.chat([{ role: "user", content: "hi" }])) {
      if (chunk.type === "text") chunks.push(chunk.text);
    }

    const full = chunks.join("");
    expect(full).not.toContain("<think>");
    expect(full).toContain("visible text");
  });
});
