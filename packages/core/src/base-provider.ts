// Abstract base class for LLM providers.
//
// Wraps the subclass's _chat() implementation and warns at runtime
// if no usage chunk was yielded — preventing silent fallback to
// inaccurate char-based token estimation.

import type { Message, Provider, ProviderOptions, ProviderChunk } from "./types";

export abstract class AbstractProvider implements Provider {
  abstract readonly name: string;

  async *chat(messages: Message[], options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    let sawUsage = false;
    for await (const chunk of this._chat(messages, options)) {
      if (chunk.type === "usage") sawUsage = true;
      yield chunk;
    }
    if (!sawUsage) {
      console.warn(
        `[spaceduck] Provider "${this.name}" did not yield a usage chunk. Cost estimation will fall back to char-based approximation.`,
      );
    }
  }

  protected abstract _chat(
    messages: Message[],
    options?: ProviderOptions,
  ): AsyncIterable<ProviderChunk>;
}
