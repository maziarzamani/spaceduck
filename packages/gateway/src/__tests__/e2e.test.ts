import { describe, it, expect, afterEach } from "bun:test";
import { createGateway, Gateway } from "../gateway";
import type { Message, Provider, ProviderOptions, ProviderChunk } from "@spaceduck/core";

process.env.SPACEDUCK_REQUIRE_AUTH = "0";

/** Minimal mock provider for smoke testing */
class SmokeTestProvider implements Provider {
  readonly name = "smoke-test";
  async *chat(messages: Message[], options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    yield { type: "text", text: "Hello " };
    yield { type: "text", text: "from " };
    yield { type: "text", text: "spaceduck!" };
  }
}

async function createTestGateway(port: number): Promise<Gateway> {
  return createGateway({
    provider: new SmokeTestProvider(),
    config: {
      port,
      logLevel: "error",
      provider: { name: "smoke-test", model: "test" },
      memory: { backend: "sqlite", connectionString: ":memory:" },
      channels: ["web"],
    },
  });
}

describe("Gateway E2E smoke", () => {
  let gateway: Gateway;
  const PORT = 49152 + Math.floor(Math.random() * 10000);

  afterEach(async () => {
    if (gateway?.status === "running") {
      await gateway.stop();
    }
  });

  it("should start and respond to health check", async () => {
    gateway = await createTestGateway(PORT);
    await gateway.start();

    expect(gateway.status).toBe("running");

    const res = await fetch(`http://localhost:${PORT}/api/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.provider).toBe("smoke-test");
    expect(body.memory).toBe("sqlite");
    expect(typeof body.uptime).toBe("number");
  });

  it("should return 404 for unknown routes", async () => {
    gateway = await createTestGateway(PORT);
    await gateway.start();

    const res = await fetch(`http://localhost:${PORT}/api/nope`);
    expect(res.status).toBe(404);
  });

  it("should list conversations (initially empty)", async () => {
    gateway = await createTestGateway(PORT);
    await gateway.start();

    const res = await fetch(`http://localhost:${PORT}/api/conversations`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.conversations).toEqual([]);
  });

  it("should run agent loop and persist messages", async () => {
    gateway = await createTestGateway(PORT);
    await gateway.start();

    const { agent, conversationStore, sessionManager } = gateway.deps;

    // Resolve a session (creates a conversation)
    const session = await sessionManager.resolve("web", "test-user");
    await conversationStore.create(session.conversationId, "Smoke test");

    // Run agent
    const userMessage: Message = {
      id: "msg-1",
      role: "user",
      content: "Hello!",
      timestamp: Date.now(),
    };

    const chunks: string[] = [];
    for await (const chunk of agent.run(session.conversationId, userMessage)) {
      if (chunk.type === "text") chunks.push(chunk.text);
    }

    expect(chunks.join("")).toBe("Hello from spaceduck!");

    // Verify messages were persisted
    const msgs = await conversationStore.loadMessages(session.conversationId);
    expect(msgs.ok).toBe(true);
    if (msgs.ok) {
      expect(msgs.value).toHaveLength(2);
      expect(msgs.value[0].role).toBe("user");
      expect(msgs.value[1].role).toBe("assistant");
      expect(msgs.value[1].content).toBe("Hello from spaceduck!");
    }

    // Verify conversation shows in list
    const listRes = await fetch(`http://localhost:${PORT}/api/conversations`);
    const listBody = await listRes.json();
    expect(listBody.conversations.length).toBe(1);
    expect(listBody.conversations[0].id).toBe(session.conversationId);
  });

  it("should be idempotent on start/stop", async () => {
    gateway = await createTestGateway(PORT);

    await gateway.start();
    await gateway.start(); // no-op
    expect(gateway.status).toBe("running");

    await gateway.stop();
    await gateway.stop(); // no-op
    expect(gateway.status).toBe("stopped");
  });
});
