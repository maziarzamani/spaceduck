import { describe, it, expect, afterEach } from "bun:test";
import { createGateway, Gateway } from "../gateway";
import type { Message, Provider, ProviderChunk, WsServerEnvelope } from "@spaceduck/core";

class StubProvider implements Provider {
  readonly name = "reconnect-test";
  async *chat(): AsyncIterable<ProviderChunk> {
    yield { type: "text", text: "ok" };
  }
}

const PORT = 49300 + Math.floor(Math.random() * 500);

async function boot(authRequired: boolean): Promise<Gateway> {
  process.env.SPACEDUCK_REQUIRE_AUTH = authRequired ? "1" : "0";
  const gw = await createGateway({
    provider: new StubProvider(),
    config: {
      port: PORT,
      logLevel: "error",
      provider: { name: "reconnect-test", model: "test" },
      memory: { backend: "sqlite", connectionString: ":memory:" },
      channels: ["web"],
    },
  });
  await gw.start();
  return gw;
}

async function pairAndGetToken(port: number): Promise<string> {
  const startRes = await fetch(`http://localhost:${port}/api/pair/start`, {
    method: "POST",
  });
  const { pairingId } = (await startRes.json()) as { pairingId: string };

  const pairPage = await fetch(`http://localhost:${port}/pair`);
  const html = await pairPage.text();
  const code = html.match(/<div class="code"[^>]*>(\d{6})<\/div>/)![1];

  const confirmRes = await fetch(`http://localhost:${port}/api/pair/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingId, code, deviceName: "reconnect-test" }),
  });
  const { token } = (await confirmRes.json()) as { token: string };
  return token;
}

function openWs(
  port: number,
  token?: string,
): Promise<{ ws: WebSocket; firstMsg: WsServerEnvelope }> {
  return new Promise((resolve, reject) => {
    const url = token
      ? `ws://localhost:${port}/ws?token=${encodeURIComponent(token)}`
      : `ws://localhost:${port}/ws`;
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WS open timed out"));
    }, 5000);

    ws.onmessage = (e) => {
      clearTimeout(timer);
      const msg = JSON.parse(e.data as string) as WsServerEnvelope;
      resolve({ ws, firstMsg: msg });
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({ v: 1, type: "conversation.list" }));
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("WS connection error"));
    };
  });
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.addEventListener("close", () => resolve());
    setTimeout(resolve, 5000);
  });
}

describe("WebSocket reconnection scenarios", () => {
  let gateway: Gateway;

  afterEach(async () => {
    if (gateway?.status === "running") {
      await gateway.stop();
    }
    delete process.env.SPACEDUCK_REQUIRE_AUTH;
  });

  it("WS connects without auth when auth is disabled", async () => {
    gateway = await boot(false);
    const { ws, firstMsg } = await openWs(PORT);
    expect(firstMsg.type).toBe("conversation.list");
    ws.close();
  });

  it("WS connects with valid token when auth is enabled", async () => {
    gateway = await boot(true);
    const token = await pairAndGetToken(PORT);
    const { ws, firstMsg } = await openWs(PORT, token);
    expect(firstMsg.type).toBe("conversation.list");
    ws.close();
  });

  it("WS rejects connection without token when auth is enabled", async () => {
    gateway = await boot(true);
    const result = await new Promise<"open" | "fail">((resolve) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
      ws.onopen = () => {
        ws.close();
        resolve("open");
      };
      ws.onerror = () => resolve("fail");
      ws.onclose = () => resolve("fail");
      setTimeout(() => resolve("fail"), 3000);
    });
    expect(result).toBe("fail");
  });

  it("WS rejects connection with invalid token", async () => {
    gateway = await boot(true);
    const result = await new Promise<"open" | "fail">((resolve) => {
      const ws = new WebSocket(
        `ws://localhost:${PORT}/ws?token=totally-bogus-token`,
      );
      ws.onopen = () => {
        ws.close();
        resolve("open");
      };
      ws.onerror = () => resolve("fail");
      ws.onclose = () => resolve("fail");
      setTimeout(() => resolve("fail"), 3000);
    });
    expect(result).toBe("fail");
  });

  it("client WS closes when gateway stops", async () => {
    gateway = await boot(false);
    const { ws } = await openWs(PORT);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    await gateway.stop();
    await waitForClose(ws);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("client can reconnect after gateway restart (no auth)", async () => {
    gateway = await boot(false);
    const { ws: ws1 } = await openWs(PORT);
    expect(ws1.readyState).toBe(WebSocket.OPEN);

    await gateway.stop();
    await waitForClose(ws1);

    gateway = await boot(false);
    const { ws: ws2, firstMsg } = await openWs(PORT);
    expect(firstMsg.type).toBe("conversation.list");
    ws2.close();
  });

  it("client can reconnect after gateway restart (with auth, fresh pairing)", async () => {
    gateway = await boot(true);
    const token1 = await pairAndGetToken(PORT);
    const { ws: ws1 } = await openWs(PORT, token1);
    expect(ws1.readyState).toBe(WebSocket.OPEN);

    await gateway.stop();
    await waitForClose(ws1);

    // Restart — in-memory DB is gone, so old token is invalid.
    // Re-pair to get a new token.
    gateway = await boot(true);
    const token2 = await pairAndGetToken(PORT);
    const { ws: ws2, firstMsg } = await openWs(PORT, token2);
    expect(firstMsg.type).toBe("conversation.list");
    ws2.close();
  });

  it("health endpoint remains responsive after WS churn", async () => {
    gateway = await boot(false);

    for (let i = 0; i < 5; i++) {
      const { ws } = await openWs(PORT);
      ws.close();
      await waitForClose(ws);
    }

    const res = await fetch(`http://localhost:${PORT}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("gateway returns 401 on /api/gateway/info with revoked token", async () => {
    gateway = await boot(true);
    const token = await pairAndGetToken(PORT);

    const before = await fetch(`http://localhost:${PORT}/api/gateway/info`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.status).toBe(200);

    // Revoke
    await fetch(`http://localhost:${PORT}/api/tokens/revoke`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const after = await fetch(`http://localhost:${PORT}/api/gateway/info`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });

  it("public-info reports requiresAuth correctly", async () => {
    gateway = await boot(true);
    const res = await fetch(
      `http://localhost:${PORT}/api/gateway/public-info`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requiresAuth: boolean };
    expect(body.requiresAuth).toBe(true);

    await gateway.stop();
    gateway = await boot(false);
    const res2 = await fetch(
      `http://localhost:${PORT}/api/gateway/public-info`,
    );
    const body2 = (await res2.json()) as { requiresAuth: boolean };
    expect(body2.requiresAuth).toBe(false);
  });

  it("concurrent WS connections all receive conversation.list", async () => {
    gateway = await boot(false);
    const connections = await Promise.all([
      openWs(PORT),
      openWs(PORT),
      openWs(PORT),
    ]);

    for (const { ws, firstMsg } of connections) {
      expect(firstMsg.type).toBe("conversation.list");
      ws.close();
    }
  });

  it("rapid connect/disconnect cycles don't crash the gateway", async () => {
    gateway = await boot(false);

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        new Promise<void>((resolve) => {
          const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
          ws.onopen = () => {
            ws.close();
            resolve();
          };
          ws.onerror = () => resolve();
          ws.onclose = () => resolve();
          setTimeout(resolve, 2000);
        }),
      );
    }
    await Promise.all(promises);

    expect(gateway.status).toBe("running");
    const res = await fetch(`http://localhost:${PORT}/api/health`);
    expect(res.status).toBe(200);
  });
});
