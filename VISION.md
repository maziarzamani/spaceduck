# Vision

Spaceduck is a local-first personal AI assistant. You run it, you own it, it remembers you.

It started as a personal project to build something genuinely useful — an assistant that persists context across conversations, connects to the channels you already use, and can take real actions on your behalf. Everything from scratch, no framework magic.

## What we are building

A small, composable runtime for personal AI:

- **Memory that lasts.** Facts are extracted from every conversation, embedded as vectors, and recalled semantically. The assistant remembers you without you having to repeat yourself.
- **Provider-agnostic.** Swap your chat model, embedding model, or provider via a single environment variable. Local models, cloud models — the runtime does not care.
- **Channel-native.** Talk to your assistant through the interfaces you already use: a web UI, WhatsApp, and eventually Discord, Telegram, and SMS. The assistant comes to you.
- **Tools that work.** Browser control, web fetch, and an extensible tool registry. The agent loop handles multi-round tool execution automatically.
- **No server required.** Runs on your laptop with `bun run dev`. No cloud infrastructure, no vendor lock-in.

## Architecture philosophy

- **No agent frameworks.** Every layer — context management, memory, tool execution, provider abstraction — is handwritten TypeScript. This keeps the codebase readable, debuggable, and dependency-free at the core.
- **Result, not throw.** Library code returns `Result<T, E>`. Errors are values, not surprises.
- **Stream everything.** LLM responses stream token-by-token to the channel. Users see output immediately.
- **Memory is semantic.** Facts are embedded and recalled by meaning, not keyword. FTS5 is the fallback when vector search is unavailable.
- **Tools return text.** Tool results are plain strings the LLM reads. No structured schemas, no silent failures.

## Current focus

1. Stability — reliable connections, clean error recovery
2. Memory quality — better fact extraction, hybrid recall (vector + FTS5 with RRF ranking)
3. Channel coverage — Discord, Telegram, CLI
4. Web search tool — real-time information retrieval

## Contribution rules

- **One PR = one topic.** Do not mix unrelated fixes or features.
- **PRs over 500 changed lines** get extra review time. If yours is large, justify it in the description.
- **No new dependencies at the core.** `packages/core` has zero runtime dependencies by design. Keep it that way.
- **Maintain the extension contracts.** `Provider`, `EmbeddingProvider`, `Channel`, and tool interfaces are public API. Changes that break them require a major version bump and a migration path.
- **Tests for new behavior.** If it is worth shipping, it is worth testing.

## What Spaceduck is not

- A hosted service or SaaS
- An LLM wrapper (the runtime is the product)
- A replacement for full agent frameworks for teams — it is sized for personal use

## By Maziar Zamani

Spaceduck is a personal project. It is not a product and not a startup. The goal is to build something genuinely useful, keep it well-crafted, and share it openly.
