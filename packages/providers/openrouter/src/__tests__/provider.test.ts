import { describe, test, expect, mock, afterEach } from "bun:test";
import { OpenRouterProvider } from "../provider";
import { ProviderError } from "@spaceduck/core";
import type { ProviderChunk } from "@spaceduck/core";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

function makeProvider(opts: Partial<{ apiKey: string; model: string }> = {}) {
  return new OpenRouterProvider({ apiKey: opts.apiKey ?? "or-test-key", ...opts });
}

async function collectChunks(iter: AsyncIterable<ProviderChunk>): Promise<ProviderChunk[]> {
  const results: ProviderChunk[] = [];
  for await (const chunk of iter) results.push(chunk);
  return results;
}

describe("OpenRouterProvider", () => {
  test("defaults model to free tier", () => {
    const p = makeProvider();
    expect((p as any).model).toContain("free");
  });

  test("uses provided model", () => {
    const p = makeProvider({ model: "anthropic/claude-3-haiku" });
    expect((p as any).model).toBe("anthropic/claude-3-haiku");
  });

  test("yields text chunks from SSE stream", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(sseResponse([sseTextChunk("Hello "), sseTextChunk("OpenRouter"), sseFinish("stop"), sseDone])),
    );

    const p = makeProvider();
    const chunks = await collectChunks(p.chat([{ role: "user", content: "hi" }]));

    const texts = chunks.filter((c) => c.type === "text").map((c) => (c as any).text);
    expect(texts).toEqual(["Hello ", "OpenRouter"]);
  });

  test("yields tool_call chunks", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        sseResponse([
          sseToolDelta(0, "tc-1", "search", '{"q":'),
          sseToolDelta(0, undefined, undefined, '"v"}'),
          sseFinish("tool_calls"),
          sseDone,
        ]),
      ),
    );

    const p = makeProvider();
    const chunks = await collectChunks(p.chat([{ role: "user", content: "go" }]));

    const toolCalls = chunks.filter((c) => c.type === "tool_call");
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0] as any).toolCall.name).toBe("search");
    expect((toolCalls[0] as any).toolCall.args).toEqual({ q: "v" });
  });

  test("sends correct headers including OpenRouter-specific ones", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve(sseResponse([sseFinish("stop"), sseDone]));
    });

    const p = makeProvider({ apiKey: "or-key" });
    await collectChunks(p.chat([{ role: "user", content: "hi" }]));

    expect(capturedHeaders["Authorization"]).toBe("Bearer or-key");
    expect(capturedHeaders["HTTP-Referer"]).toBe("https://spaceduck.ai");
    expect(capturedHeaders["X-Title"]).toBe("spaceduck");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
  });

  test("sends require_parameters in body", async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(sseResponse([sseFinish("stop"), sseDone]));
    });

    const p = makeProvider();
    await collectChunks(p.chat([{ role: "user", content: "hi" }]));

    expect((capturedBody.provider as any).require_parameters).toBe(true);
    expect(capturedBody.stream).toBe(true);
  });

  test("converts tool definitions to wire format", async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(sseResponse([sseFinish("stop"), sseDone]));
    });

    const p = makeProvider();
    await collectChunks(
      p.chat([{ role: "user", content: "search" }], {
        tools: [{ name: "web_search", description: "Search", parameters: { type: "object" } }],
      }),
    );

    expect(capturedBody.tools).toBeDefined();
    const tools = capturedBody.tools as any[];
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.name).toBe("web_search");
  });

  test("converts all message roles to wire format", async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(sseResponse([sseFinish("stop"), sseDone]));
    });

    const p = makeProvider();
    await collectChunks(
      p.chat([
        { role: "system", content: "Be helpful" },
        { role: "user", content: "find cats" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "tc1", name: "search", args: { q: "cats" } }],
        },
        { role: "tool", content: "Results here", toolCallId: "tc1" },
        { role: "assistant", content: "Here are the results." },
      ]),
    );

    const msgs = capturedBody.messages as any[];
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[2].role).toBe("assistant");
    expect(msgs[2].tool_calls).toBeDefined();
    expect(msgs[3].role).toBe("tool");
    expect(msgs[3].tool_call_id).toBe("tc1");
    expect(msgs[4].role).toBe("assistant");
  });

  test("throws ProviderError on HTTP error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Internal Server Error", { status: 500 })),
    );

    const p = makeProvider();
    try {
      await collectChunks(p.chat([{ role: "user", content: "hi" }]));
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
    }
  });

  test("classifies auth errors on fetch failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Unauthorized API key", { status: 401 })),
    );

    const p = makeProvider();
    try {
      await collectChunks(p.chat([{ role: "user", content: "hi" }]));
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).message).toContain("401");
    }
  });

  test("classifies network errors", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED")));

    const p = makeProvider();
    try {
      await collectChunks(p.chat([{ role: "user", content: "hi" }]));
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).providerCode).toBe("transient_network");
    }
  });

  test("flushes remaining tool calls at end of stream", async () => {
    // Tool call without a finish_reason — should still be emitted at end
    globalThis.fetch = mock(() =>
      Promise.resolve(
        sseResponse([
          sseToolDelta(0, "tc-1", "tool_a", '{"x":1}'),
          sseDone,
        ]),
      ),
    );

    const p = makeProvider();
    const chunks = await collectChunks(p.chat([{ role: "user", content: "go" }]));

    const toolCalls = chunks.filter((c) => c.type === "tool_call");
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0] as any).toolCall.id).toBe("tc-1");
  });
});
