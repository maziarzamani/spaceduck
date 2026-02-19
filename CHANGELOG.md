# Changelog

All notable changes are documented here.
Format: [Keep a Changelog](https://keepachangelog.com) · Versioning: [SemVer](https://semver.org)
From v0.1.0 onwards this file is updated automatically by release-please on every release.

---

## [0.8.0](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.7.0...spaceduck-v0.8.0) (2026-02-19)


### Features

* add gateway pairing and token authentication (Slice 1) ([6edc6c3](https://github.com/maziarzamani/spaceduck/commit/6edc6c3e856a7afc51b43a157d2372f9cc043fc5))
* add view router, extract ChatView, and add shadcn primitives (Slice 2) ([5329fdc](https://github.com/maziarzamani/spaceduck/commit/5329fdc64a1c9bfed7fa9d40a1f6d283153863c9))
* implement onboarding wizard with 5-screen pairing flow (Slice 3) ([14d8642](https://github.com/maziarzamani/spaceduck/commit/14d864267e7d0d1184feedc6ac5df96f8c67752a))
* implement settings page with device management (Slice 4) ([39a770f](https://github.com/maziarzamani/spaceduck/commit/39a770ff770459f5d56563c45b6a8d23ce2d350c))

## [0.7.0](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.6.1...spaceduck-v0.7.0) (2026-02-19)


### Features

* add PDF document scanning via Marker and file upload infrastructure ([ff2816d](https://github.com/maziarzamani/spaceduck/commit/ff2816d12ffad4e4f3ab9e4145447c030b8baeb7))


### Bug Fixes

* ignore data/uploads/ in any subdirectory, not just repo root ([e3a2da8](https://github.com/maziarzamani/spaceduck/commit/e3a2da8e4ed2c0e8aae1c9c7a4f215b1cb4dae55))

## [0.6.1](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.6.0...spaceduck-v0.6.1) (2026-02-19)


### Bug Fixes

* **ui:** filter tool messages from history, add target=_blank to markdown links ([900c89e](https://github.com/maziarzamani/spaceduck/commit/900c89e2036909f713d397bf6f91c366d60abfd3))

## [0.6.0](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.5.0...spaceduck-v0.6.0) (2026-02-19)


### Features

* **desktop:** replace placeholder Tauri icons with spaceduck logo ([9628789](https://github.com/maziarzamani/spaceduck/commit/9628789104e0b055e98ce1b8bd1b602eb9a4f992))

## [0.5.0](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.4.0...spaceduck-v0.5.0) (2026-02-19)


### Features

* **tools:** add web_search + web_answer tools with Brave, Perplexity, SearXNG ([042c6ef](https://github.com/maziarzamani/spaceduck/commit/042c6ef0eb35d4e720682f24573bc6d32682417c))

## [0.4.0](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.3.0...spaceduck-v0.4.0) (2026-02-19)


### Features

* **desktop:** scaffold Tauri v2 desktop app with sidecar architecture ([87da5ab](https://github.com/maziarzamani/spaceduck/commit/87da5abcca81454f2ae2df0b785b704f2eac2699))
* shared UI architecture — web + desktop from one codebase ([ec01c71](https://github.com/maziarzamani/spaceduck/commit/ec01c714365d5430424455503999dfd8371de3e4))
* **ui:** rebuild interface with shadcn/ui components + auto-reconnect ([064d654](https://github.com/maziarzamani/spaceduck/commit/064d654062fa1e35dcabac1eb895dcdef0619c9f))


### Bug Fixes

* **desktop:** compilation fixes — imports, externals, placeholder icons ([591dc94](https://github.com/maziarzamani/spaceduck/commit/591dc943ed68df3c6e993e7d8b6fe6820f95b679))

## [0.3.0](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.2.0...spaceduck-v0.3.0) (2026-02-18)


### Features

* initial release — memory v2, bedrock, web UI, whatsapp ([e97997f](https://github.com/maziarzamani/spaceduck/commit/e97997f69b660cab4ad37b8458933f4badffe74b))


### Bug Fixes

* prevent release-please from bumping to 1.0.0 ([9f354ce](https://github.com/maziarzamani/spaceduck/commit/9f354ce6809d9de3a680f7ec071940b4461a47e7))

## [0.2.0](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.1.0...spaceduck-v0.2.0) (2026-02-18)


### Features

* initial release — memory v2, bedrock, web UI, whatsapp ([e97997f](https://github.com/maziarzamani/spaceduck/commit/e97997f69b660cab4ad37b8458933f4badffe74b))


### Bug Fixes

* prevent release-please from bumping to 1.0.0 ([9f354ce](https://github.com/maziarzamani/spaceduck/commit/9f354ce6809d9de3a680f7ec071940b4461a47e7))

## [0.1.0] — 2026-02-18 — Initial release

### Added
- AgentLoop — multi-round tool execution with tool → result → LLM cycles
- ContextBuilder — token budget, system prompt, LTM recall, auto-compaction, afterTurn eager flush
- Memory v2 — hybrid recall (RRF: vector cosine + FTS5 BM25), recency decay, memory firewall, SQL expiry pushdown
- Providers — Gemini, LM Studio, OpenRouter, Amazon Bedrock (native Converse API + Titan V2 embeddings)
- Web channel — React chat UI, streaming deltas, conversation sidebar
- WhatsApp channel — Baileys, QR pairing, typing indicators
- Browser tool — Playwright headless with accessibility snapshot refs
- Web fetch tool — HTTP fetch + HTML-to-text
- GitHub Actions CI — matrix (Ubuntu + macOS), auto-approve on green CI
