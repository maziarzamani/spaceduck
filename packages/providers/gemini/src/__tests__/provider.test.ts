import { describe, test, expect, mock, afterEach } from "bun:test";
import { ProviderError } from "@spaceduck/core";
import type { ProviderChunk } from "@spaceduck/core";

// We test the internal helpers (toGeminiContents, toGeminiFunctionDeclarations, classifyError)
// by exercising GeminiProvider.chat with a mocked GoogleGenAI SDK.

// Mock @google/genai before importing
const mockGenerateContentStream = mock();

mock.module("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContentStream: mockGenerateContentStream,
    };
  },
}));

const { GeminiProvider } = await import("../provider");

function makeProvider(opts: { model?: string } = {}) {
  return new GeminiProvider({ apiKey: "test-key", ...opts });
}

async function collectChunks(iter: AsyncIterable<ProviderChunk>): Promise<ProviderChunk[]> {
  const results: ProviderChunk[] = [];
  for await (const chunk of iter) results.push(chunk);
  return results;
}

let _msgId = 0;
function msg(m: { role: string; content: string; toolCalls?: any[]; toolCallId?: string; toolName?: string }): any {
  return { id: `test-${++_msgId}`, timestamp: Date.now(), ...m };
}

describe("GeminiProvider", () => {
  afterEach(() => {
    mockGenerateContentStream.mockReset();
  });

  test("constructor uses default model when none specified", () => {
    const p = makeProvider();
    expect((p as any).model).toBe("gemini-2.5-flash");
  });

  test("constructor uses provided model", () => {
    const p = makeProvider({ model: "gemini-pro" });
    expect((p as any).model).toBe("gemini-pro");
  });

  test("yields text chunks from streaming response", async () => {
    mockGenerateContentStream.mockReturnValue(
      Promise.resolve(
        (async function* () {
          yield { text: "Hello " };
          yield { text: "world" };
        })(),
      ),
    );

    const p = makeProvider();
    const chunks = await collectChunks(p.chat([msg({ role: "user", content: "hi" })]));

    expect(chunks).toEqual([
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
    ]);
  });

  test("yields tool_call chunks when functionCalls are present", async () => {
    mockGenerateContentStream.mockReturnValue(
      Promise.resolve(
        (async function* () {
          yield {
            text: undefined,
            functionCalls: [
              { id: "fc-1", name: "web_search", args: { query: "test" } },
            ],
          };
        })(),
      ),
    );

    const p = makeProvider();
    const chunks = await collectChunks(
      p.chat([msg({ role: "user", content: "search" })], {
        tools: [{ name: "web_search", description: "Search", parameters: {} }],
      }),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("tool_call");
    if (chunks[0].type === "tool_call") {
      expect(chunks[0].toolCall.name).toBe("web_search");
      expect(chunks[0].toolCall.args).toEqual({ query: "test" });
    }
  });

  test("handles mixed text + tool_call chunks", async () => {
    mockGenerateContentStream.mockReturnValue(
      Promise.resolve(
        (async function* () {
          yield { text: "Let me search for that.", functionCalls: undefined };
          yield {
            text: undefined,
            functionCalls: [{ name: "web_search", args: { query: "q" } }],
          };
        })(),
      ),
    );

    const p = makeProvider();
    const chunks = await collectChunks(p.chat([msg({ role: "user", content: "find" })]));

    expect(chunks[0]).toEqual({ type: "text", text: "Let me search for that." });
    expect(chunks[1].type).toBe("tool_call");
  });

  test("converts system messages to systemInstruction", async () => {
    let capturedArgs: Record<string, unknown> = {};
    mockGenerateContentStream.mockImplementation((args: Record<string, unknown>) => {
      capturedArgs = args;
      return Promise.resolve(
        (async function* () {
          yield { text: "ok" };
        })(),
      );
    });

    const p = makeProvider();
    await collectChunks(
      p.chat([
        msg({ role: "system", content: "Be helpful" }),
        msg({ role: "user", content: "hi" }),
      ]),
    );

    expect(capturedArgs.config).toBeDefined();
    expect((capturedArgs.config as any).systemInstruction).toBe("Be helpful");
  });

  test("converts tool messages to user role with functionResponse", async () => {
    let capturedArgs: Record<string, unknown> = {};
    mockGenerateContentStream.mockImplementation((args: Record<string, unknown>) => {
      capturedArgs = args;
      return Promise.resolve(
        (async function* () {
          yield { text: "done" };
        })(),
      );
    });

    const p = makeProvider();
    await collectChunks(
      p.chat([
        msg({ role: "user", content: "search for cats" }),
        msg({
          role: "assistant",
          content: "",
          toolCalls: [{ id: "tc1", name: "web_search", args: { query: "cats" } }],
        }),
        msg({ role: "tool", content: "Found 10 results", toolCallId: "tc1", toolName: "web_search" }),
      ]),
    );

    const contents = capturedArgs.contents as Array<{ role: string; parts: any[] }>;
    const toolMsg = contents.find(
      (c) => c.parts?.[0]?.functionResponse,
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.role).toBe("user");
  });

  test("throws ProviderError on SDK failure", async () => {
    mockGenerateContentStream.mockReturnValue(
      Promise.reject(new Error("Rate limit exceeded")),
    );

    const p = makeProvider();
    try {
      await collectChunks(p.chat([msg({ role: "user", content: "hi" })]));
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).providerCode).toBe("throttled");
    }
  });

  test("classifies auth errors correctly", async () => {
    mockGenerateContentStream.mockReturnValue(
      Promise.reject(new Error("Invalid API key")),
    );

    const p = makeProvider();
    try {
      await collectChunks(p.chat([msg({ role: "user", content: "hi" })]));
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).providerCode).toBe("auth_failed");
    }
  });

  test("classifies network errors correctly", async () => {
    mockGenerateContentStream.mockReturnValue(
      Promise.reject(new Error("fetch failed")),
    );

    const p = makeProvider();
    try {
      await collectChunks(p.chat([msg({ role: "user", content: "hi" })]));
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).providerCode).toBe("transient_network");
    }
  });

  test("returns silently when signal is aborted", async () => {
    const ac = new AbortController();
    ac.abort();

    mockGenerateContentStream.mockReturnValue(
      Promise.resolve(
        (async function* () {
          yield { text: "should not appear" };
        })(),
      ),
    );

    const p = makeProvider();
    const chunks = await collectChunks(
      p.chat([msg({ role: "user", content: "hi" })], { signal: ac.signal }),
    );

    expect(chunks).toEqual([]);
  });

  test("sends tool definitions in Gemini format", async () => {
    let capturedArgs: Record<string, unknown> = {};
    mockGenerateContentStream.mockImplementation((args: Record<string, unknown>) => {
      capturedArgs = args;
      return Promise.resolve(
        (async function* () {
          yield { text: "ok" };
        })(),
      );
    });

    const p = makeProvider();
    await collectChunks(
      p.chat([msg({ role: "user", content: "search" })], {
        tools: [
          {
            name: "web_search",
            description: "Search the web",
            parameters: { type: "object", properties: { query: { type: "string" } } },
          },
        ],
      }),
    );

    const config = capturedArgs.config as Record<string, unknown>;
    expect(config.tools).toBeDefined();
    const tools = config.tools as any[];
    expect(tools[0].functionDeclarations).toHaveLength(1);
    expect(tools[0].functionDeclarations[0].name).toBe("web_search");
  });
});
