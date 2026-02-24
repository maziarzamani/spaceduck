import { describe, test, expect, mock, afterEach } from "bun:test";
import { GeminiEmbeddingProvider } from "../embedding";
import { ProviderError } from "@spaceduck/core";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeProvider(opts: { model?: string; apiKey?: string } = {}) {
  return new GeminiEmbeddingProvider({ apiKey: opts.apiKey ?? "test-key", model: opts.model });
}

function mockFetchOk(body: unknown) {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
  ) as any;
}

describe("GeminiEmbeddingProvider", () => {
  test("defaults to text-embedding-004 model", () => {
    const p = makeProvider();
    expect(p.model).toBe("text-embedding-004");
    expect(p.dimensions).toBe(768);
  });

  test("accepts custom model", () => {
    const p = makeProvider({ model: "custom-embed" });
    expect(p.model).toBe("custom-embed");
  });

  describe("embed", () => {
    test("returns Float32Array for valid response", async () => {
      const values = Array.from({ length: 768 }, (_, i) => i * 0.001);
      mockFetchOk({ embedding: { values } });

      const p = makeProvider();
      const result = await p.embed("hello");

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(768);
    });

    test("throws on dimension mismatch", async () => {
      mockFetchOk({ embedding: { values: [0.1, 0.2, 0.3] } });

      const p = makeProvider();
      try {
        await p.embed("hello");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).message).toContain("dimension mismatch");
      }
    });

    test("throws on missing embedding.values", async () => {
      mockFetchOk({});

      const p = makeProvider();
      try {
        await p.embed("hello");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).message).toContain("missing embedding.values");
      }
    });

    test("throws ProviderError on auth failure (401)", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response("Unauthorized", { status: 401 })),
      ) as any;

      const p = makeProvider();
      try {
        await p.embed("hello");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).providerCode).toBe("auth_failed");
      }
    });

    test("throws transient_network on connection failure", async () => {
      globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED"))) as any;

      const p = makeProvider();
      try {
        await p.embed("hello");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).providerCode).toBe("transient_network");
      }
    });
  });

  describe("embedBatch", () => {
    test("returns empty array for empty input", async () => {
      const p = makeProvider();
      const result = await p.embedBatch([]);
      expect(result).toEqual([]);
    });

    test("returns Float32Array[] for batch response", async () => {
      const values = Array.from({ length: 768 }, (_, i) => i * 0.001);
      mockFetchOk({ embeddings: [{ values }, { values }] });

      const p = makeProvider();
      const result = await p.embedBatch(["hello", "world"]);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(Float32Array);
      expect(result[1]).toBeInstanceOf(Float32Array);
    });

    test("throws on missing embeddings array in batch", async () => {
      mockFetchOk({});

      const p = makeProvider();
      try {
        await p.embedBatch(["hello"]);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).message).toContain("missing embeddings array");
      }
    });

    test("throws transient_network on batch connection failure", async () => {
      globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED"))) as any;

      const p = makeProvider();
      try {
        await p.embedBatch(["hello"]);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).providerCode).toBe("transient_network");
      }
    });
  });
});
