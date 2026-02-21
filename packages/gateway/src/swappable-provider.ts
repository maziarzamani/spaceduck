import type {
  Provider,
  ProviderOptions,
  ProviderChunk,
  Message,
} from "@spaceduck/core";

/**
 * Thin proxy that delegates to a mutable inner Provider.
 * Allows hot-swapping the AI provider at runtime without
 * rebuilding AgentLoop, FactExtractor, or other consumers.
 *
 * In-flight chat() iterators continue on the previous provider
 * instance (they already captured their own fetch stream).
 */
export class SwappableProvider implements Provider {
  private inner: Provider;

  constructor(initial: Provider) {
    this.inner = initial;
  }

  get name(): string {
    return this.inner.name;
  }

  chat(
    messages: Message[],
    options?: ProviderOptions,
  ): AsyncIterable<ProviderChunk> {
    return this.inner.chat(messages, options);
  }

  /** Replace the inner provider. Calls dispose() on the old one if present. */
  swap(next: Provider): void {
    const prev = this.inner;
    this.inner = next;
    if (typeof (prev as any).dispose === "function") {
      (prev as any).dispose();
    }
  }

  get current(): Provider {
    return this.inner;
  }
}
