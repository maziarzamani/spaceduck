---
name: add-provider
description: Scaffold a new LLM provider package for spaceduck
---

# Add Provider

Scaffolds a new LLM provider adapter under `packages/providers/<name>/`.

## Steps

1. Ask for the provider name (e.g., "openai", "ollama", "anthropic")
2. Create the directory structure:

```
packages/providers/<name>/
  package.json          # @spaceduck/provider-<name>, depends on @spaceduck/core
  src/
    <name>.ts           # <Name>Provider implements Provider interface
    index.ts            # barrel export
    __tests__/
      <name>.test.ts    # unit tests with mocked SDK
```

3. The provider must implement the `Provider` interface from `@spaceduck/core`:

```typescript
import type { Provider, Message, ProviderOptions } from "@spaceduck/core";

export class <Name>Provider implements Provider {
  readonly name = "<name>";

  async *chat(messages: Message[], options?: ProviderOptions): AsyncIterable<string> {
    // Implementation here
    // Must respect options.signal (AbortSignal) for cancellation
  }
}
```

4. Add the provider to `@spaceduck/gateway` by importing and wiring it in the registry
5. Map provider-specific exceptions to `ProviderErrorCode` values
6. Write unit tests using `spyOn` to mock the SDK client
