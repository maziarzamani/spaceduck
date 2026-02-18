import { describe, it, expect } from "bun:test";
import { MockEmbeddingProvider, BadDimensionEmbeddingProvider } from "../__fixtures__/mock-embedding";

describe("MockEmbeddingProvider", () => {
  const provider = new MockEmbeddingProvider(4);

  it("should return vectors of correct dimensions", async () => {
    const vec = await provider.embed("hello world");
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(4);
  });

  it("should return deterministic vectors", async () => {
    const vec1 = await provider.embed("hello world");
    const vec2 = await provider.embed("hello world");
    expect(Array.from(vec1)).toEqual(Array.from(vec2));
  });

  it("should return similar vectors for similar text", async () => {
    const vec1 = await provider.embed("the dog is running");
    const vec2 = await provider.embed("the dog is walking");
    const vec3 = await provider.embed("quantum physics equations");

    // Cosine similarity between similar texts should be higher
    const sim12 = cosineSimilarity(vec1, vec2);
    const sim13 = cosineSimilarity(vec1, vec3);
    expect(sim12).toBeGreaterThan(sim13);
  });

  it("should return unit vectors (L2 norm ~1)", async () => {
    const vec = await provider.embed("test input");
    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
      norm += vec[i] * vec[i];
    }
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 4);
  });

  it("should embed batch of texts", async () => {
    const vecs = await provider.embedBatch(["hello", "world", "test"]);
    expect(vecs).toHaveLength(3);
    for (const vec of vecs) {
      expect(vec).toBeInstanceOf(Float32Array);
      expect(vec.length).toBe(4);
    }
  });

  it("should return empty array for empty batch", async () => {
    const vecs = await provider.embedBatch([]);
    expect(vecs).toEqual([]);
  });

  it("should support custom dimensions", async () => {
    const provider768 = new MockEmbeddingProvider(768);
    const vec = await provider768.embed("test");
    expect(vec.length).toBe(768);
    expect(provider768.dimensions).toBe(768);
  });
});

describe("BadDimensionEmbeddingProvider", () => {
  it("should declare one dimension but return another", async () => {
    const bad = new BadDimensionEmbeddingProvider(1024, 768);
    expect(bad.dimensions).toBe(1024);
    const vec = await bad.embed("test");
    expect(vec.length).toBe(768); // Mismatch!
  });
});

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
