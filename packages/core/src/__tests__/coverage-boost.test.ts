import { describe, it, expect, beforeEach } from "bun:test";
import { DefaultContextBuilder, DEFAULT_TOKEN_BUDGET } from "../context-builder";
import { MockConversationStore, MockLongTermMemory } from "../__fixtures__/mock-memory";
import { MockProvider } from "../__fixtures__/mock-provider";
import { createMessage, createConversation, resetFixtures } from "../__fixtures__/messages";
import { ConsoleLogger } from "../types/logger";
import {
  SpaceduckError,
  ProviderError,
  MemoryError,
  ChannelError,
  ConfigError,
  SessionError,
} from "../types/errors";

const logger = new ConsoleLogger("error");

describe("DefaultContextBuilder.compact", () => {
  let store: MockConversationStore;
  let ltm: MockLongTermMemory;
  let builder: DefaultContextBuilder;
  let provider: MockProvider;

  beforeEach(() => {
    resetFixtures();
    store = new MockConversationStore();
    ltm = new MockLongTermMemory();
    builder = new DefaultContextBuilder(store, ltm, logger);
    provider = new MockProvider(["This is a summary of the conversation."]);
  });

  it("should skip compaction for conversations with fewer than 10 messages", async () => {
    await store.create("conv-1");
    for (let i = 0; i < 5; i++) {
      await store.appendMessage(
        "conv-1",
        createMessage({ content: `Message ${i}`, timestamp: Date.now() + i }),
      );
    }

    const result = await builder.compact("conv-1", provider);
    expect(result.ok).toBe(true);
    // Provider should not have been called
    expect(provider.callHistory).toHaveLength(0);
  });

  it("should compact conversations with 10+ messages", async () => {
    await store.create("conv-1");
    for (let i = 0; i < 12; i++) {
      await store.appendMessage(
        "conv-1",
        createMessage({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i} with some content for the conversation`,
          timestamp: Date.now() + i,
        }),
      );
    }

    const result = await builder.compact("conv-1", provider);
    expect(result.ok).toBe(true);

    // Provider should have been called: once for flush extraction, once for summary
    expect(provider.callHistory.length).toBeGreaterThanOrEqual(1);

    // A compaction system message should have been appended
    const msgs = await store.loadMessages("conv-1");
    expect(msgs.ok).toBe(true);
    if (msgs.ok) {
      const compactionMsgs = msgs.value.filter(
        (m) => m.source === "compaction",
      );
      expect(compactionMsgs.length).toBeGreaterThanOrEqual(1);
      expect(compactionMsgs[0].content).toContain("[Conversation summary]");
    }
  });
});

describe("Error classes", () => {
  it("should create SpaceduckError with code", () => {
    const err = new SpaceduckError("test", "TEST_CODE");
    expect(err.message).toBe("test");
    expect(err.code).toBe("TEST_CODE");
    expect(err.name).toBe("SpaceduckError");
  });

  it("should create ProviderError", () => {
    const err = new ProviderError("provider failed", "throttled");
    expect(err.code).toBe("PROVIDER_ERROR");
    expect(err.providerCode).toBe("throttled");
    expect(err.name).toBe("ProviderError");
  });

  it("should create MemoryError", () => {
    const err = new MemoryError("db down");
    expect(err.code).toBe("MEMORY_ERROR");
    expect(err.name).toBe("MemoryError");
  });

  it("should create ChannelError", () => {
    const err = new ChannelError("ws failed");
    expect(err.code).toBe("CHANNEL_ERROR");
    expect(err.name).toBe("ChannelError");
  });

  it("should create ConfigError", () => {
    const err = new ConfigError("bad config");
    expect(err.code).toBe("CONFIG_ERROR");
    expect(err.name).toBe("ConfigError");
  });

  it("should create SessionError", () => {
    const err = new SessionError("session expired");
    expect(err.code).toBe("SESSION_ERROR");
    expect(err.name).toBe("SessionError");
  });

  it("should preserve cause", () => {
    const cause = new Error("root cause");
    const err = new MemoryError("wrapper", cause);
    expect(err.cause).toBe(cause);
  });
});

describe("Test fixtures", () => {
  it("createConversation should create with defaults", () => {
    resetFixtures();
    const conv = createConversation();
    expect(conv.id).toBeTruthy();
    expect(conv.messages).toEqual([]);
    expect(conv.createdAt).toBeGreaterThan(0);
  });

  it("createConversation should accept overrides", () => {
    const conv = createConversation({ title: "Test", messages: [] });
    expect(conv.title).toBe("Test");
  });

  it("resetFixtures should reset counter", () => {
    resetFixtures();
    const m1 = createMessage();
    resetFixtures();
    const m2 = createMessage();
    expect(m1.id).toBe(m2.id);
  });
});

describe("MockConversationStore extended coverage", () => {
  let store: MockConversationStore;

  beforeEach(() => {
    store = new MockConversationStore();
  });

  it("should handle create with title", async () => {
    const result = await store.create("c1", "My Chat");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("My Chat");
    }
  });

  it("should update title", async () => {
    await store.create("c1", "Old");
    await store.updateTitle("c1", "New");
    const loaded = await store.load("c1");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value?.title).toBe("New");
    }
  });

  it("should delete conversation", async () => {
    await store.create("c1");
    await store.delete("c1");
    const loaded = await store.load("c1");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toBeNull();
    }
  });

  it("should list all conversations", async () => {
    await store.create("c1");
    await store.create("c2");
    const result = await store.list();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });

  it("should load messages with limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.appendMessage("c1", createMessage({ content: `msg-${i}` }));
    }
    const result = await store.loadMessages("c1", 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });
});

describe("MockLongTermMemory extended coverage", () => {
  let ltm: MockLongTermMemory;

  beforeEach(() => {
    ltm = new MockLongTermMemory();
  });

  it("should recall with keyword matching", async () => {
    await ltm.remember({ conversationId: "c1", content: "User likes Bun runtime" });
    await ltm.remember({ conversationId: "c1", content: "User prefers dark themes" });

    const result = await ltm.recall("Bun");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(1);
      expect(result.value[0].content).toContain("Bun");
    }
  });

  it("should list all facts without filter", async () => {
    await ltm.remember({ conversationId: "c1", content: "Fact A" });
    await ltm.remember({ conversationId: "c2", content: "Fact B" });

    const all = await ltm.listAll();
    expect(all.ok).toBe(true);
    if (all.ok) {
      expect(all.value).toHaveLength(2);
    }
  });

  it("should forget a specific fact", async () => {
    const remembered = await ltm.remember({ conversationId: "c1", content: "Temp fact" });
    expect(remembered.ok).toBe(true);
    if (remembered.ok) {
      await ltm.forget(remembered.value.id);
      const all = await ltm.listAll();
      if (all.ok) {
        expect(all.value).toHaveLength(0);
      }
    }
  });
});
