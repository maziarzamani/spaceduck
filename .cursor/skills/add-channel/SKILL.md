---
name: add-channel
description: Scaffold a new messaging channel package for spaceduck
---

# Add Channel

Scaffolds a new messaging channel under `packages/channels/<name>/`.

## Steps

1. Ask for the channel name (e.g., "discord", "telegram", "slack")
2. Create the directory structure:

```
packages/channels/<name>/
  package.json          # @spaceduck/channel-<name>, depends on @spaceduck/core
  src/
    server.ts           # channel server implementation
    index.ts            # barrel export
    __tests__/
      server.test.ts    # integration tests
```

3. The channel must implement the `Channel` interface from `@spaceduck/core`:

```typescript
import type { Channel, Lifecycle } from "@spaceduck/core";

export class <Name>Channel implements Channel, Lifecycle {
  readonly name = "<name>";
  readonly status: "stopped" | "starting" | "running" | "stopping" = "stopped";

  async start(): Promise<void> { /* start listening for messages */ }
  async stop(): Promise<void> { /* graceful shutdown */ }

  // Channel-specific message handling
}
```

4. The channel receives messages from its platform and forwards them through the gateway's middleware pipeline
5. The channel receives responses from the agent and delivers them back to the user
6. Wire the channel in `@spaceduck/gateway` by adding it to the registry
7. Write integration tests that spin up a real server instance
