import { describe, it, expect, beforeEach } from "bun:test";
import { AgentLoop } from "../agent";
import type { AgentChunk } from "../agent";
import { SimpleEventBus } from "../events";
import { DefaultContextBuilder, DEFAULT_TOKEN_BUDGET } from "../context-builder";
import { InMemorySessionManager } from "../session-manager";
import { MockProvider } from "../__fixtures__/mock-provider";
import { MockConversationStore } from "../__fixtures__/mock-memory";
import { createMessage } from "../__fixtures__/messages";
import { ConsoleLogger } from "../types/logger";
import type { SpaceduckEvents } from "../events";

/** Collect only text from agent chunks */
function collectText(chunks: AgentChunk[]): string {
  return chunks
    .filter((c): c is Extract<AgentChunk, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("");
}

describe("AgentLoop", () => {
  let agent: AgentLoop;
  let provider: MockProvider;
  let store: MockConversationStore;
  let eventBus: SimpleEventBus;
  let logger: ConsoleLogger;

  beforeEach(() => {
    logger = new ConsoleLogger("error");
    provider = new MockProvider(["Hello from the agent!"]);
    store = new MockConversationStore();
    eventBus = new SimpleEventBus(logger);

    agent = new AgentLoop({
      provider,
      conversationStore: store,
      contextBuilder: new DefaultContextBuilder(store, undefined, logger),
      sessionManager: new InMemorySessionManager(),
      eventBus,
      logger,
    });
  });

  it("should stream response chunks", async () => {
    const convId = "conv-1";
    await store.create(convId);

    const userMsg = createMessage({ content: "Hello!" });
    const chunks: AgentChunk[] = [];

    for await (const chunk of agent.run(convId, userMsg)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(collectText(chunks)).toContain("Hello");
  });

  it("should persist user and assistant messages", async () => {
    const convId = "conv-1";
    await store.create(convId);

    const userMsg = createMessage({ content: "Hello!" });
    // Consume the stream
    for await (const _ of agent.run(convId, userMsg)) {
      // drain
    }

    const result = await store.loadMessages(convId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(2); // user + assistant
      expect(result.value[0].role).toBe("user");
      expect(result.value[1].role).toBe("assistant");
    }
  });

  it("should emit message:received and message:response events", async () => {
    const convId = "conv-1";
    await store.create(convId);

    const received: SpaceduckEvents["message:received"][] = [];
    const responded: SpaceduckEvents["message:response"][] = [];

    eventBus.on("message:received", (d) => { received.push(d); });
    eventBus.on("message:response", (d) => { responded.push(d); });

    const userMsg = createMessage({ content: "Hello!" });
    for await (const _ of agent.run(convId, userMsg)) {
      // drain
    }

    expect(received).toHaveLength(1);
    expect(received[0].conversationId).toBe(convId);
    expect(responded).toHaveLength(1);
    expect(responded[0].message.role).toBe("assistant");
    expect(responded[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should pass messages to provider", async () => {
    const convId = "conv-1";
    await store.create(convId);

    const userMsg = createMessage({ content: "What is Bun?" });
    for await (const _ of agent.run(convId, userMsg)) {
      // drain
    }

    expect(provider.callHistory).toHaveLength(1);
    const lastCall = provider.lastCall()!;
    expect(lastCall.some((m) => m.content === "What is Bun?")).toBe(true);
  });

  it("should respect AbortSignal", async () => {
    const convId = "conv-1";
    await store.create(convId);

    provider.setResponses(["This is a very long response that should be cut short by the abort signal"]);

    const controller = new AbortController();
    const userMsg = createMessage({ content: "Hello!" });
    const chunks: AgentChunk[] = [];

    // Abort after first chunk
    for await (const chunk of agent.run(convId, userMsg, { signal: controller.signal })) {
      chunks.push(chunk);
      controller.abort();
    }

    // Should have received at least one chunk but not the full response
    expect(chunks.length).toBeGreaterThan(0);
  });
});
