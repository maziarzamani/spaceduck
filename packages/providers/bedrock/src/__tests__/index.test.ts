import { describe, test, expect, mock, afterEach } from "bun:test";
import { BedrockProvider, BedrockEmbeddingProvider } from "../index";
import { ProviderError } from "@spaceduck/core";
import type { ProviderChunk } from "@spaceduck/core";

let _msgId = 0;
function msg(m: { role: string; content: string; toolCalls?: any[]; toolCallId?: string; toolName?: string }): any {
  return { id: `test-${++_msgId}`, timestamp: Date.now(), ...m };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function collectChunks(iter: AsyncIterable<ProviderChunk>): Promise<ProviderChunk[]> {
  const results: ProviderChunk[] = [];
  for await (const chunk of iter) results.push(chunk);
  return results;
}

describe("BedrockProvider", () => {
  test("uses default model and region", () => {
    const p = new BedrockProvider({ apiKey: "test" });
    expect((p as any).model).toBe("global.amazon.nova-2-lite-v1:0");
    // Region falls back to AWS_REGION env or us-east-1
    expect((p as any).baseUrl).toContain("bedrock-runtime.");
  });

  test("accepts custom model and region", () => {
    const p = new BedrockProvider({ apiKey: "test", model: "custom-model", region: "eu-west-1" });
    expect((p as any).model).toBe("custom-model");
    expect((p as any).baseUrl).toContain("eu-west-1");
  });

  test("yields text chunks from Converse API response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            output: {
              message: {
                role: "assistant",
                content: [{ text: "Hello from Bedrock" }],
              },
            },
            stopReason: "end_turn",
          }),
          { status: 200 },
        ),
      ),
    ) as any;

    const p = new BedrockProvider({ apiKey: "test-key" });
    const chunks = await collectChunks(p.chat([msg({ role: "user", content: "hi" })]));

    expect(chunks).toEqual([{ type: "text", text: "Hello from Bedrock" }]);
  });

  test("yields tool_call chunks from Converse API response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            output: {
              message: {
                role: "assistant",
                content: [
                  { toolUse: { toolUseId: "tu-1", name: "web_search", input: { query: "test" } } },
                ],
              },
            },
            stopReason: "tool_use",
          }),
          { status: 200 },
        ),
      ),
    ) as any;

    const p = new BedrockProvider({ apiKey: "test-key" });
    const chunks = await collectChunks(
      p.chat([msg({ role: "user", content: "search" })], {
        tools: [{ name: "web_search", description: "Search", parameters: { type: "object" } }],
      }),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("tool_call");
    if (chunks[0].type === "tool_call") {
      expect(chunks[0].toolCall.id).toBe("tu-1");
      expect(chunks[0].toolCall.name).toBe("web_search");
      expect(chunks[0].toolCall.args).toEqual({ query: "test" });
    }
  });

  test("converts system messages to top-level system field", async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(
        new Response(
          JSON.stringify({ output: { message: { role: "assistant", content: [{ text: "ok" }] } }, stopReason: "end_turn" }),
          { status: 200 },
        ),
      );
    }) as any;

    const p = new BedrockProvider({ apiKey: "test-key" });
    await collectChunks(
      p.chat([
        msg({ role: "system", content: "Be helpful" }),
        msg({ role: "user", content: "hi" }),
      ]),
    );

    expect(capturedBody.system).toEqual([{ text: "Be helpful" }]);
  });

  test("merges consecutive same-role messages", async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(
        new Response(
          JSON.stringify({ output: { message: { role: "assistant", content: [{ text: "ok" }] } }, stopReason: "end_turn" }),
          { status: 200 },
        ),
      );
    }) as any;

    const p = new BedrockProvider({ apiKey: "test-key" });
    await collectChunks(
      p.chat([
        msg({ role: "user", content: "hello" }),
        msg({ role: "user", content: "world" }),
      ]),
    );

    const msgs = capturedBody.messages as any[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toHaveLength(2);
  });

  test("throws ProviderError on HTTP error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Bad request", { status: 400 })),
    ) as any;

    const p = new BedrockProvider({ apiKey: "test-key" });
    try {
      await collectChunks(p.chat([msg({ role: "user", content: "hi" })]));
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
    }
  });

  test("throws transient_network on connection failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED"))) as any;

    const p = new BedrockProvider({ apiKey: "test-key" });
    try {
      await collectChunks(p.chat([msg({ role: "user", content: "hi" })]));
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).providerCode).toBe("transient_network");
    }
  });

  test("throws on non-JSON response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("not json", { status: 200 })),
    ) as any;

    const p = new BedrockProvider({ apiKey: "test-key" });
    try {
      await collectChunks(p.chat([msg({ role: "user", content: "hi" })]));
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).providerCode).toBe("invalid_request");
    }
  });

  test("sends Authorization header with Bearer token", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve(
        new Response(
          JSON.stringify({ output: { message: { role: "assistant", content: [{ text: "ok" }] } }, stopReason: "end_turn" }),
          { status: 200 },
        ),
      );
    }) as any;

    const p = new BedrockProvider({ apiKey: "my-token" });
    await collectChunks(p.chat([msg({ role: "user", content: "hi" })]));

    expect(capturedHeaders["Authorization"]).toBe("Bearer my-token");
  });
});

describe("BedrockEmbeddingProvider", () => {
  test("defaults to Titan model", () => {
    const p = new BedrockEmbeddingProvider({ apiKey: "test" });
    expect(p.model).toBe("amazon.titan-embed-text-v2:0");
    expect(p.dimensions).toBe(1024);
    expect((p as any).isNova).toBe(false);
  });

  test("detects Nova model", () => {
    const p = new BedrockEmbeddingProvider({
      apiKey: "test",
      model: "amazon.nova-2-multimodal-embeddings-v1:0",
    });
    expect((p as any).isNova).toBe(true);
  });

  test("embed returns Float32Array for Titan response", async () => {
    const values = Array.from({ length: 1024 }, (_, i) => i * 0.001);
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ embedding: values }), { status: 200 })),
    ) as any;

    const p = new BedrockEmbeddingProvider({ apiKey: "test" });
    const result = await p.embed("hello");

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(1024);
  });

  test("embed returns Float32Array for Nova response", async () => {
    const values = Array.from({ length: 1024 }, (_, i) => i * 0.001);
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ embeddings: [{ embedding: values }] }),
          { status: 200 },
        ),
      ),
    ) as any;

    const p = new BedrockEmbeddingProvider({
      apiKey: "test",
      model: "amazon.nova-2-multimodal-embeddings-v1:0",
    });
    const result = await p.embed("hello");

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(1024);
  });

  test("throws on auth failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401 })),
    ) as any;

    const p = new BedrockEmbeddingProvider({ apiKey: "bad" });
    try {
      await p.embed("hello");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).providerCode).toBe("auth_failed");
    }
  });

  test("throws on connection failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED"))) as any;

    const p = new BedrockEmbeddingProvider({ apiKey: "test" });
    try {
      await p.embed("hello");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).providerCode).toBe("transient_network");
    }
  });

  test("embedBatch returns empty array for empty input", async () => {
    const p = new BedrockEmbeddingProvider({ apiKey: "test" });
    const result = await p.embedBatch([]);
    expect(result).toEqual([]);
  });

  test("throws on Titan dimension mismatch", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ embedding: [0.1, 0.2] }), { status: 200 })),
    ) as any;

    const p = new BedrockEmbeddingProvider({ apiKey: "test" });
    try {
      await p.embed("hello");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).message).toContain("dimension mismatch");
    }
  });

  test("throws on missing Titan embedding array", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    ) as any;

    const p = new BedrockEmbeddingProvider({ apiKey: "test" });
    try {
      await p.embed("hello");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).message).toContain("missing");
    }
  });
});
