import type { EmbeddingProvider, EmbedOptions } from "@spaceduck/core";

/**
 * Thin proxy that delegates to a mutable inner EmbeddingProvider.
 * Allows hot-swapping the embedding provider at runtime without
 * rebuilding SqliteLongTermMemory or other consumers.
 *
 * Pass undefined as the initial value to start in "disabled" state.
 */
export class SwappableEmbeddingProvider implements EmbeddingProvider {
  private inner: EmbeddingProvider | undefined;

  constructor(initial?: EmbeddingProvider) {
    this.inner = initial;
  }

  get name(): string {
    return this.inner?.name ?? "disabled";
  }

  get model(): string {
    return this.inner?.model ?? "";
  }

  get dimensions(): number {
    return this.inner?.dimensions ?? 0;
  }

  get isConfigured(): boolean {
    return this.inner !== undefined;
  }

  embed(text: string, options?: EmbedOptions): Promise<Float32Array> {
    if (!this.inner) {
      return Promise.reject(new Error("Embeddings disabled"));
    }
    return this.inner.embed(text, options);
  }

  embedBatch(texts: string[], options?: EmbedOptions): Promise<Float32Array[]> {
    if (!this.inner) {
      return Promise.reject(new Error("Embeddings disabled"));
    }
    return this.inner.embedBatch(texts, options);
  }

  /** Replace the inner provider. Pass undefined to disable embeddings. */
  swap(next: EmbeddingProvider | undefined): void {
    this.inner = next;
  }

  get current(): EmbeddingProvider | undefined {
    return this.inner;
  }
}
