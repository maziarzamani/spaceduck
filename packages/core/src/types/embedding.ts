// Embedding provider interface for vector-based semantic memory
//
// Implementations must validate that returned vectors match `dimensions`.
// If the model returns a different length, throw a MemoryError.

/** Semantic purpose hint for asymmetric embedding models (e.g., Nova 2). */
export type EmbedPurpose = "index" | "retrieval";

export interface EmbedOptions {
  purpose?: EmbedPurpose;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;

  /** Embed a single text string into a float vector. */
  embed(text: string, options?: EmbedOptions): Promise<Float32Array>;

  /** Embed multiple texts in a single batch call (more efficient for bulk operations). */
  embedBatch(texts: string[], options?: EmbedOptions): Promise<Float32Array[]>;
}
