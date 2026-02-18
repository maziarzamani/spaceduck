// Embedding provider interface for vector-based semantic memory
//
// Implementations must validate that returned vectors match `dimensions`.
// If the model returns a different length, throw a MemoryError.

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;

  /** Embed a single text string into a float vector. */
  embed(text: string): Promise<Float32Array>;

  /** Embed multiple texts in a single batch call (more efficient for bulk operations). */
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}
