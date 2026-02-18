// Dev server entry point — starts gateway with a mock provider
// so you can test the UI without a real API key.
// Usage: bun run dev:mock

import type { Message, Provider, ProviderOptions, ProviderChunk } from "@spaceduck/core";
import { createGateway } from "./gateway";

const mockProvider: Provider = {
  name: "mock",
  async *chat(messages: Message[], options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    const lastMsg = messages[messages.length - 1];
    const response = `I'm a mock spaceduck! You said: "${lastMsg.content}".\n\nI can respond with **markdown**, \`inline code\`, and more:\n\n\`\`\`typescript\nconsole.log("Hello from spaceduck!");\n\`\`\`\n\nPretty cool, right?`;

    // Simulate streaming by yielding chunks
    const words = response.split(" ");
    for (const word of words) {
      yield { type: "text", text: word + " " };
      await Bun.sleep(30);
    }
  },
};

const gateway = await createGateway({
  provider: mockProvider,
  config: {
    port: 3000,
    logLevel: "debug",
    provider: { name: "mock", model: "mock-v1" },
    memory: { backend: "sqlite", connectionString: ":memory:" },
    channels: ["web"],
  },
});

await gateway.start();
console.log("\n  🦆 spaceduck dev server running at http://localhost:3000\n");
