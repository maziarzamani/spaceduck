---
name: add-memory
description: Scaffold a new memory storage backend for spaceduck
---

# Add Memory Backend

Scaffolds a new memory storage backend under `packages/memory/<name>/`.

## Steps

1. Ask for the backend name (e.g., "pinecone", "pgvector", "milvus", "turbopuffer")
2. Determine if the backend needs an `EmbeddingProvider` (vector DBs do, text-search backends don't)
3. Create the directory structure:

```
packages/memory/<name>/
  package.json          # @spaceduck/memory-<name>, depends on @spaceduck/core
  src/
    store.ts            # <Name>ConversationStore implements ConversationStore
    long-term.ts        # <Name>LongTermMemory implements LongTermMemory
    index.ts            # barrel export
    __tests__/
      store.test.ts
      long-term.test.ts
```

4. Implement the `ConversationStore` interface:

```typescript
import type { ConversationStore, Conversation, Message, Result, MemoryError, Lifecycle } from "@spaceduck/core";

export class <Name>ConversationStore implements ConversationStore, Lifecycle {
  // CRUD for conversations and messages
}
```

5. Implement the `LongTermMemory` interface:

```typescript
import type { LongTermMemory, Fact, Lifecycle } from "@spaceduck/core";

export class <Name>LongTermMemory implements LongTermMemory, Lifecycle {
  // For vector backends: accept EmbeddingProvider via constructor
  // recall(query) internally embeds the query and does similarity search
}
```

6. Wire the backend in `@spaceduck/gateway` as an alternative to the default SQLite backend
7. Write integration tests using real DB connections (or in-memory variants)
