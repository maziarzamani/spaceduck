// Test fixture: deterministic embedding provider for unit tests
//
// Produces consistent vectors where semantically similar strings
// yield similar vectors (based on character frequency distribution).

import type { EmbeddingProvider } from "../types/embedding";

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";
  readonly model = "mock-model";
  readonly dimensions: number;

  constructor(dimensions: number = 4) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<Float32Array> {
    return this.hashToVector(text);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.hashToVector(t));
  }

  /**
   * Deterministic hash-to-vector: produces a float vector from text content.
   * Similar strings produce similar vectors by using character frequency
   * distribution across `dimensions` buckets.
   */
  private hashToVector(text: string): Float32Array {
    const vec = new Float32Array(this.dimensions);
    const normalized = text.toLowerCase().trim();

    // Distribute character codes across buckets
    for (let i = 0; i < normalized.length; i++) {
      const bucket = normalized.charCodeAt(i) % this.dimensions;
      vec[bucket] += 1;
    }

    // Normalize to unit vector (L2 norm)
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        vec[i] /= norm;
      }
    }

    return vec;
  }
}

/**
 * Mock that returns wrong dimensions -- for testing dimension validation.
 */
export class BadDimensionEmbeddingProvider implements EmbeddingProvider {
  readonly name = "bad-dims";
  readonly model = "bad-dims-model";
  readonly dimensions: number;
  private readonly actualDimensions: number;

  constructor(declaredDimensions: number, actualDimensions: number) {
    this.dimensions = declaredDimensions;
    this.actualDimensions = actualDimensions;
  }

  async embed(text: string): Promise<Float32Array> {
    return new Float32Array(this.actualDimensions);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array(this.actualDimensions));
  }
}
