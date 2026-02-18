// Test fixture: mock provider that yields configurable canned responses

import type { Message, Provider, ProviderOptions, ProviderChunk } from "../types";

export class MockProvider implements Provider {
  readonly name = "mock";
  public callHistory: Message[][] = [];

  constructor(private responses: string[] = ["Hello from mock provider."]) {}

  async *chat(messages: Message[], options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    this.callHistory.push([...messages]);

    for (const response of this.responses) {
      for (const word of response.split(" ")) {
        if (options?.signal?.aborted) {
          return;
        }
        yield { type: "text", text: word + " " };
      }
    }
  }

  /** Set the responses for the next call. */
  setResponses(responses: string[]): void {
    this.responses = responses;
  }

  /** Get the messages from the last call. */
  lastCall(): Message[] | undefined {
    return this.callHistory.at(-1);
  }
}
