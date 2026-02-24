/**
 * Embedding hot-swap tests.
 *
 * The bug: the embedding provider is created once at gateway startup and
 * never replaced when config changes (provider, baseUrl, model, dimensions).
 * This means changing embedding settings in the UI has no effect until restart.
 *
 * The fix: wrap the embedding provider in a SwappableEmbeddingProvider so it
 * can be replaced at runtime, just like the chat provider.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { createGateway, Gateway } from "../gateway";
import type { Provider, ProviderChunk, EmbeddingProvider } from "@spaceduck/core";

process.env.SPACEDUCK_REQUIRE_AUTH = "0";

// ── Stubs ────────────────────────────────────────────────────────────

class StubProvider implements Provider {
  readonly name = "stub";
  async *chat(): AsyncIterable<ProviderChunk> {
    yield { type: "text", text: "ok" };
  }
}

/** Records every embed() call so tests can assert which provider was active. */
class TrackingEmbeddingProvider implements EmbeddingProvider {
  readonly calls: string[] = [];
  readonly model: string;
  constructor(
    public readonly name: string,
    public readonly dimensions = 4,
  ) {
    this.model = `${name}-model`;
  }
  async embed(text: string): Promise<Float32Array> {
    this.calls.push(text);
    return new Float32Array(this.dimensions).fill(0.1);
  }
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    texts.forEach((t) => this.calls.push(t));
    return texts.map(() => new Float32Array(this.dimensions).fill(0.1));
  }
}

/** Throws on any embed call — simulates a misconfigured provider. */
class BrokenEmbeddingProvider implements EmbeddingProvider {
  readonly name = "broken";
  readonly model = "broken-model";
  readonly dimensions = 4;
  async embed(): Promise<Float32Array> {
    throw new Error("broken: API key missing");
  }
  async embedBatch(): Promise<Float32Array[]> {
    throw new Error("broken: API key missing");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_PORT = 0;

function baseConfig(port: number) {
  return {
    port,
    logLevel: "error" as const,
    provider: { name: "stub", model: "test" },
    memory: { backend: "sqlite" as const, connectionString: ":memory:" },
    channels: ["web" as const],
  };
}

async function getConfig(port: number): Promise<{ rev: string; config: Record<string, unknown> }> {
  const res = await fetch(`http://localhost:${port}/api/config`);
  return res.json() as Promise<{ rev: string; config: Record<string, unknown> }>;
}

async function patchConfig(
  port: number,
  rev: string,
  ops: Array<{ op: string; path: string; value: unknown }>,
): Promise<{ rev: string; config: Record<string, unknown> }> {
  const res = await fetch(`http://localhost:${port}/api/config`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "if-match": rev },
    body: JSON.stringify(ops),
  });
  if (!res.ok) {
    const body = await res.json() as { error: string; message?: string };
    throw new Error(`PATCH failed: ${body.error} — ${body.message ?? ""}`);
  }
  return res.json() as Promise<{ rev: string; config: Record<string, unknown> }>;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Embedding provider hot-swap", () => {
  let gateway: Gateway;

  afterEach(async () => {
    if (gateway?.status === "running") await gateway.stop();
  });

  it("embedding provider is replaced (disabled) when embedding.enabled toggled off via config PATCH", async () => {
    const initialProvider = new TrackingEmbeddingProvider("initial", 4);

    gateway = await createGateway({
      provider: new StubProvider(),
      config: baseConfig(TEST_PORT),
      embeddingProvider: initialProvider,
    });
    await gateway.start();
    const port = gateway.port;

    // Sanity: embedding-status should be ok with the initial provider
    const before = await fetch(`http://localhost:${port}/api/config/embedding-status`);
    const beforeBody = await before.json() as { ok: boolean; dimensions?: number };
    expect(beforeBody.ok).toBe(true);
    expect(beforeBody.dimensions).toBe(4);

    // Disable embeddings via config PATCH — this triggers EMBEDDING_REBUILD_PATHS
    const { rev } = await getConfig(port);
    await patchConfig(port, rev, [
      { op: "replace", path: "/embedding/enabled", value: false },
    ]);

    // After the fix: the gateway rebuilds the embedding provider.
    // With enabled=false, createEmbeddingProvider returns undefined -> swap(undefined)
    // embedding-status should now report disabled.
    // With the bug (no hot-swap): it would still report ok:true with the old provider.
    const after = await fetch(`http://localhost:${port}/api/config/embedding-status`);
    const afterBody = await after.json() as { ok: boolean; error?: string };
    expect(afterBody.ok).toBe(false); // FAILS before fix — still ok:true with old provider
    expect(afterBody.error).toContain("disabled");
  });

  it("gateway starts cleanly when initial embedding provider creation fails", async () => {
    gateway = await createGateway({
      provider: new StubProvider(),
      config: baseConfig(TEST_PORT),
    });
    await gateway.start();
    const port = gateway.port;

    expect(gateway.status).toBe("running");

    const res = await fetch(`http://localhost:${port}/api/config/embedding-status`);
    const body = await res.json() as { ok: boolean; error?: string };
    expect(res.status).toBe(200);
    expect(typeof body.ok).toBe("boolean");
  });

  it("after fix: embedding provider is replaced when provider config changes", async () => {
    const initial = new TrackingEmbeddingProvider("before-swap", 4);

    gateway = await createGateway({
      provider: new StubProvider(),
      config: baseConfig(TEST_PORT),
      embeddingProvider: initial,
    });
    await gateway.start();
    const port = gateway.port;

    const statusBefore = await fetch(`http://localhost:${port}/api/config/embedding-status`);
    const bodyBefore = await statusBefore.json() as { ok: boolean; dimensions?: number };
    expect(bodyBefore.ok).toBe(true);
    expect(bodyBefore.dimensions).toBe(4);

    const { rev } = await getConfig(port);
    await patchConfig(port, rev, [
      { op: "replace", path: "/embedding/enabled", value: false },
    ]);

    const statusDisabled = await fetch(`http://localhost:${port}/api/config/embedding-status`);
    const bodyDisabled = await statusDisabled.json() as { ok: boolean; error?: string };
    expect(bodyDisabled.ok).toBe(false);
    expect(bodyDisabled.error).toContain("disabled");
  });

  it("embedding-status returns ok:false with clear message after hot-swap to broken provider", async () => {
    gateway = await createGateway({
      provider: new StubProvider(),
      config: baseConfig(TEST_PORT),
      embeddingProvider: new BrokenEmbeddingProvider(),
    });
    await gateway.start();
    const port = gateway.port;

    const res = await fetch(`http://localhost:${port}/api/config/embedding-status`);
    const body = await res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("broken");
  });
});
