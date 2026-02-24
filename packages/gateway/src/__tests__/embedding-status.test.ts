import { describe, it, expect, afterEach } from "bun:test";
import { createGateway, Gateway } from "../gateway";
import type { Message, Provider, ProviderChunk, EmbeddingProvider } from "@spaceduck/core";

process.env.SPACEDUCK_REQUIRE_AUTH = "0";

class StubProvider implements Provider {
  readonly name = "stub";
  async *chat(): AsyncIterable<ProviderChunk> {
    yield { type: "text", text: "ok" };
  }
}

class OkEmbeddingProvider implements EmbeddingProvider {
  readonly name = "stub-embed";
  readonly model = "stub-model";
  readonly dimensions = 4;
  async embed(): Promise<Float32Array> {
    return new Float32Array([0.1, 0.2, 0.3, 0.4]);
  }
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
  }
}

class FailingEmbeddingProvider implements EmbeddingProvider {
  readonly name = "stub-embed-fail";
  readonly model = "stub-model";
  readonly dimensions = 4;
  async embed(): Promise<Float32Array> {
    throw new Error("embed server unreachable");
  }
  async embedBatch(): Promise<Float32Array[]> {
    throw new Error("embed server unreachable");
  }
}

function baseConfig(port: number) {
  return {
    port,
    logLevel: "error" as const,
    provider: { name: "stub", model: "test" },
    memory: { backend: "sqlite" as const, connectionString: ":memory:" },
    channels: ["web" as const],
  };
}

const TEST_PORT = 0;

describe("GET /api/config/embedding-status", () => {
  let gateway: Gateway;

  afterEach(async () => {
    if (gateway?.status === "running") await gateway.stop();
  });

  it("returns ok:false when no embedding provider is configured", async () => {
    gateway = await createGateway({
      provider: new StubProvider(),
      config: baseConfig(TEST_PORT),
    });
    await gateway.start();
    const port = gateway.port;

    const res = await fetch(`http://localhost:${port}/api/config/embedding-status`);
    expect(res.status).toBe(200);

    const body = await res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Embeddings disabled");
  });

  it("returns ok:true when embedding provider responds successfully", async () => {
    gateway = await createGateway({
      provider: new StubProvider(),
      config: baseConfig(TEST_PORT),
      embeddingProvider: new OkEmbeddingProvider(),
    });
    await gateway.start();
    const port = gateway.port;

    const res = await fetch(`http://localhost:${port}/api/config/embedding-status`);
    expect(res.status).toBe(200);

    const body = await res.json() as { ok: boolean; provider?: string; dimensions?: number };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("stub-embed");
    expect(body.dimensions).toBe(4);
  });

  it("returns ok:false with error message when embedding provider throws", async () => {
    gateway = await createGateway({
      provider: new StubProvider(),
      config: baseConfig(TEST_PORT),
      embeddingProvider: new FailingEmbeddingProvider(),
    });
    await gateway.start();
    const port = gateway.port;

    const res = await fetch(`http://localhost:${port}/api/config/embedding-status`);
    expect(res.status).toBe(200);

    const body = await res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("unreachable");
  });

  it("returns 401 when auth is required and no token is provided", async () => {
    const origAuth = process.env.SPACEDUCK_REQUIRE_AUTH;
    process.env.SPACEDUCK_REQUIRE_AUTH = "1";
    try {
      gateway = await createGateway({
        provider: new StubProvider(),
        config: baseConfig(TEST_PORT),
        embeddingProvider: new OkEmbeddingProvider(),
      });
      await gateway.start();
      const port = gateway.port;

      const res = await fetch(`http://localhost:${port}/api/config/embedding-status`);
      expect(res.status).toBe(401);
    } finally {
      process.env.SPACEDUCK_REQUIRE_AUTH = origAuth;
    }
  });
});
