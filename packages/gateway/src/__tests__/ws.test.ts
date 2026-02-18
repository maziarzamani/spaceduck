import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createGateway, Gateway } from "../gateway";
import type { Message, Provider, ProviderOptions, ProviderChunk, WsServerEnvelope } from "@spaceduck/core";

class TestProvider implements Provider {
  readonly name = "ws-test";
  async *chat(messages: Message[], options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    yield { type: "text", text: "Hello " };
    yield { type: "text", text: "websocket " };
    yield { type: "text", text: "world!" };
  }
}

const PORT = 49152 + Math.floor(Math.random() * 10000);
let gateway: Gateway;

beforeAll(async () => {
  gateway = await createGateway({
    provider: new TestProvider(),
    config: {
      port: PORT,
      logLevel: "error",
      provider: { name: "ws-test", model: "test" },
      memory: { backend: "sqlite", connectionString: ":memory:" },
      channels: ["web"],
    },
  });
  await gateway.start();
});

afterAll(async () => {
  await gateway.stop();
});

function wsUrl(path: string = "/ws"): string {
  return `ws://localhost:${PORT}${path}`;
}

/** Open a WebSocket and collect messages until `done` predicate is true or timeout. */
function collectMessages(
  opts: {
    sendAfterOpen?: object;
    done: (msgs: WsServerEnvelope[]) => boolean;
    timeoutMs?: number;
    senderId?: string;
  },
): Promise<WsServerEnvelope[]> {
  return new Promise((resolve, reject) => {
    const messages: WsServerEnvelope[] = [];
    const url = opts.senderId ? `${wsUrl()}?senderId=${opts.senderId}` : wsUrl();
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      resolve(messages); // resolve with what we have instead of rejecting
    }, opts.timeoutMs ?? 5000);

    ws.onopen = () => {
      if (opts.sendAfterOpen) {
        ws.send(JSON.stringify(opts.sendAfterOpen));
      }
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as WsServerEnvelope;
      messages.push(msg);
      if (opts.done(messages)) {
        clearTimeout(timeout);
        ws.close();
        resolve(messages);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      reject(err);
    };
  });
}

describe("WebSocket protocol", () => {
  it("should upgrade to WebSocket on /ws", async () => {
    const ws = new WebSocket(wsUrl());
    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });
    ws.close();
    expect(opened).toBe(true);
  });

  it("should reject invalid JSON", async () => {
    const messages = await collectMessages({
      sendAfterOpen: "not json" as any, // will actually send as string
      done: (msgs) => msgs.length >= 1,
    });
    // We need to send raw string, not JSON
    // Use a different approach
    const ws = new WebSocket(wsUrl());
    const result = await new Promise<WsServerEnvelope>((resolve) => {
      ws.onopen = () => ws.send("not json{{{");
      ws.onmessage = (e) => {
        resolve(JSON.parse(e.data as string));
        ws.close();
      };
    });
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.code).toBe("INVALID_JSON");
    }
  });

  it("should reject unsupported protocol version", async () => {
    const ws = new WebSocket(wsUrl());
    const result = await new Promise<WsServerEnvelope>((resolve) => {
      ws.onopen = () => ws.send(JSON.stringify({ v: 99, type: "message.send" }));
      ws.onmessage = (e) => {
        resolve(JSON.parse(e.data as string));
        ws.close();
      };
    });
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.code).toBe("UNSUPPORTED_VERSION");
    }
  });

  it("should create a conversation", async () => {
    const messages = await collectMessages({
      sendAfterOpen: { v: 1, type: "conversation.create", title: "Test Chat" },
      done: (msgs) => msgs.some((m) => m.type === "conversation.created"),
    });

    const created = messages.find((m) => m.type === "conversation.created");
    expect(created).toBeDefined();
    if (created?.type === "conversation.created") {
      expect(created.conversationId).toBeTruthy();
    }
  });

  it("should list conversations", async () => {
    const messages = await collectMessages({
      sendAfterOpen: { v: 1, type: "conversation.list" },
      done: (msgs) => msgs.some((m) => m.type === "conversation.list"),
    });

    const list = messages.find((m) => m.type === "conversation.list");
    expect(list).toBeDefined();
    if (list?.type === "conversation.list") {
      expect(Array.isArray(list.conversations)).toBe(true);
    }
  });

  it("should send a message and receive streamed response", async () => {
    const messages = await collectMessages({
      senderId: "test-stream-user",
      sendAfterOpen: {
        v: 1,
        type: "message.send",
        requestId: "req-1",
        content: "Hello!",
      },
      done: (msgs) => msgs.some((m) => m.type === "stream.done"),
    });

    // Should have: accepted, processing.started, deltas, done
    const types = messages.map((m) => m.type);
    expect(types).toContain("message.accepted");
    expect(types).toContain("processing.started");
    expect(types).toContain("stream.delta");
    expect(types).toContain("stream.done");

    // Verify accepted has conversationId
    const accepted = messages.find((m) => m.type === "message.accepted");
    if (accepted?.type === "message.accepted") {
      expect(accepted.conversationId).toBeTruthy();
      expect(accepted.requestId).toBe("req-1");
    }

    // Collect all deltas
    const deltas = messages
      .filter((m): m is Extract<WsServerEnvelope, { type: "stream.delta" }> => m.type === "stream.delta")
      .map((m) => m.delta)
      .join("");

    expect(deltas).toBe("Hello websocket world!");

    // Verify done has messageId
    const done = messages.find((m) => m.type === "stream.done");
    if (done?.type === "stream.done") {
      expect(done.messageId).toBeTruthy();
      expect(done.requestId).toBe("req-1");
    }
  });

  it("should retrieve conversation history after sending messages", async () => {
    // First send a message to create a conversation
    const sendMessages = await collectMessages({
      senderId: "test-history-user",
      sendAfterOpen: {
        v: 1,
        type: "message.send",
        requestId: "req-hist",
        content: "Remember this!",
      },
      done: (msgs) => msgs.some((m) => m.type === "stream.done"),
    });

    const accepted = sendMessages.find((m) => m.type === "message.accepted");
    expect(accepted?.type).toBe("message.accepted");

    let convId = "";
    if (accepted?.type === "message.accepted") {
      convId = accepted.conversationId;
    }

    // Now request history
    const histMessages = await collectMessages({
      sendAfterOpen: { v: 1, type: "conversation.history", conversationId: convId },
      done: (msgs) => msgs.some((m) => m.type === "conversation.history"),
    });

    const history = histMessages.find((m) => m.type === "conversation.history");
    expect(history).toBeDefined();
    if (history?.type === "conversation.history") {
      expect(history.messages.length).toBeGreaterThanOrEqual(2); // user + assistant
      expect(history.messages[0].role).toBe("user");
      expect(history.messages[0].content).toBe("Remember this!");
      expect(history.messages[1].role).toBe("assistant");
    }
  });

  it("should delete a conversation", async () => {
    // Create one
    const createMsgs = await collectMessages({
      sendAfterOpen: { v: 1, type: "conversation.create", title: "To Delete" },
      done: (msgs) => msgs.some((m) => m.type === "conversation.created"),
    });

    const created = createMsgs.find((m) => m.type === "conversation.created");
    expect(created?.type).toBe("conversation.created");

    let convId = "";
    if (created?.type === "conversation.created") {
      convId = created.conversationId;
    }

    // Delete it
    const deleteMsgs = await collectMessages({
      sendAfterOpen: { v: 1, type: "conversation.delete", conversationId: convId },
      done: (msgs) => msgs.some((m) => m.type === "conversation.deleted"),
    });

    const deleted = deleteMsgs.find((m) => m.type === "conversation.deleted");
    expect(deleted).toBeDefined();
    if (deleted?.type === "conversation.deleted") {
      expect(deleted.conversationId).toBe(convId);
    }
  });
});
