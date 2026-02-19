# Changelog

All notable changes are documented here.
Format: [Keep a Changelog](https://keepachangelog.com) · Versioning: [SemVer](https://semver.org)
From v0.1.0 onwards this file is updated automatically by release-please on every release.

---

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
