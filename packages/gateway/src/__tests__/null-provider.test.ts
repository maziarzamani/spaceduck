import { describe, it, expect, afterEach } from "bun:test";
import { createGateway, Gateway } from "../gateway";
import type { Provider, ProviderChunk, ProviderOptions, Message } from "@spaceduck/core";

process.env.SPACEDUCK_REQUIRE_AUTH = "0";

// ── Helpers ──────────────────────────────────────────────────────────

class FailingProvider implements Provider {
  readonly name = "failing";
  // eslint-disable-next-line require-yield
  async *chat(): AsyncIterable<ProviderChunk> {
    throw new Error("API key not configured");
  }
}

class OkProvider implements Provider {
  readonly name = "ok";
  async *chat(): AsyncIterable<ProviderChunk> {
    yield { type: "text", text: "pong" };
  }
}

const TEST_PORT = 0;

function baseConfig(port: number) {
  return {
    port,
    logLevel: "error" as const,
    provider: { name: "test", model: "test" },
    memory: { backend: "sqlite" as const, connectionString: ":memory:" },
    channels: ["web" as const],
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("NullProvider — gateway starts without a configured provider", () => {
  let gateway: Gateway;

  afterEach(async () => {
    if (gateway?.status === "running") await gateway.stop();
  });

  it("gateway starts and health check passes even when no provider override is given", async () => {
    gateway = await createGateway({
      provider: new OkProvider(),
      config: baseConfig(TEST_PORT),
    });
    await gateway.start();
    const port = gateway.port;

    expect(gateway.status).toBe("running");
    const res = await fetch(`http://localhost:${port}/api/health`);
    expect(res.status).toBe(200);
  });

  it("provider-status returns ok:false when the provider throws during chat", async () => {
    gateway = await createGateway({
      provider: new FailingProvider(),
      config: baseConfig(TEST_PORT),
    });
    await gateway.start();
    const port = gateway.port;

    const res = await fetch(`http://localhost:${port}/api/config/provider-status`);
    expect(res.status).toBe(200);

    const body = await res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
  });

  it("gateway stays running when underlying provider yields unconfigured message", async () => {
    const nullLike: Provider = {
      name: "unconfigured",
      async *chat(): AsyncIterable<ProviderChunk> {
        yield { type: "text", text: "No AI provider is configured yet. Go to Settings → Chat to set one up." };
      },
    };

    gateway = await createGateway({
      provider: nullLike,
      config: baseConfig(TEST_PORT),
    });
    await gateway.start();
    const port = gateway.port;

    expect(gateway.status).toBe("running");

    const res = await fetch(`http://localhost:${port}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("ok");
  });

  it("NullProvider response message tells the user to configure a provider", async () => {
    const nullLike: Provider = {
      name: "unconfigured",
      async *chat(): AsyncIterable<ProviderChunk> {
        yield { type: "text", text: "No AI provider is configured yet. Go to Settings → Chat to set one up." };
      },
    };

    gateway = await createGateway({
      provider: nullLike,
      config: baseConfig(TEST_PORT),
    });
    await gateway.start();
    const port = gateway.port;

    const res = await fetch(`http://localhost:${port}/api/config/provider-status`);
    const body = await res.json() as { ok: boolean };
    expect(res.status).toBe(200);
    expect(gateway.status).toBe("running");
  });
});
