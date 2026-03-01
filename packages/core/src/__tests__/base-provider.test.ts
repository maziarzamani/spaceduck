import { describe, it, expect, spyOn } from "bun:test";
import { AbstractProvider } from "../base-provider";
import type { Message, ProviderOptions, ProviderChunk } from "../types";

class UsageProvider extends AbstractProvider {
  readonly name = "with-usage";
  protected async *_chat(_messages: Message[], _options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    yield { type: "text", text: "hello" };
    yield { type: "usage", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
  }
}

class NoUsageProvider extends AbstractProvider {
  readonly name = "no-usage";
  protected async *_chat(_messages: Message[], _options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    yield { type: "text", text: "hello" };
  }
}

function msg(content: string): Message {
  return { id: "1", role: "user", content, timestamp: Date.now() };
}

async function collectChunks(iter: AsyncIterable<ProviderChunk>): Promise<ProviderChunk[]> {
  const results: ProviderChunk[] = [];
  for await (const chunk of iter) results.push(chunk);
  return results;
}

describe("AbstractProvider", () => {
  it("passes through all chunks from _chat including usage", async () => {
    const provider = new UsageProvider();
    const chunks = await collectChunks(provider.chat([msg("hi")]));

    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe("text");
    expect(chunks[1].type).toBe("usage");
  });

  it("does not warn when usage chunk is present", async () => {
    const spy = spyOn(console, "warn").mockImplementation(() => {});
    const provider = new UsageProvider();
    await collectChunks(provider.chat([msg("hi")]));

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("warns when _chat does not yield a usage chunk", async () => {
    const spy = spyOn(console, "warn").mockImplementation(() => {});
    const provider = new NoUsageProvider();
    const chunks = await collectChunks(provider.chat([msg("hi")]));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("text");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("no-usage");
    expect(spy.mock.calls[0][0]).toContain("did not yield a usage chunk");
    spy.mockRestore();
  });
});
