# Changelog

All notable changes are documented here.
Format: [Keep a Changelog](https://keepachangelog.com) · Versioning: [SemVer](https://semver.org)
From v0.1.0 onwards this file is updated automatically by release-please on every release.

---

## [0.13.0](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.12.0...spaceduck-v0.13.0) (2026-02-22)


### Features

* harden memory pipeline — slot deactivation, contamination guard, multilingual extraction ([9ce9940](https://github.com/maziarzamani/spaceduck/commit/9ce99405d5b46a869941e7eb35457faddd9ffe75))


### Bug Fixes

* add required theme field to docs.json ([7fa3f71](https://github.com/maziarzamani/spaceduck/commit/7fa3f71613b86419c5008df4f3cd619609bcc261))
* update docs.json to match current Mintlify schema ([f752fe3](https://github.com/maziarzamani/spaceduck/commit/f752fe3c3ef70f847c7d7a9cd9a899a00214a89c))

## [0.12.0](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.11.0...spaceduck-v0.12.0) (2026-02-21)


### Features

* add CLI for config management + fix hot-apply tests + update README ([7e8ed5c](https://github.com/maziarzamani/spaceduck/commit/7e8ed5c7a457382a87488ac00025908147331dee))

## [0.11.0](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.10.0...spaceduck-v0.11.0) (2026-02-21)


### Features

* add embedding settings to UI and wire factory to product config ([093ae73](https://github.com/maziarzamani/spaceduck/commit/093ae73f97a8b8c24d5a2785e04d772d3a087abb))
* **config:** add @spaceduck/config package with Zod schema and defaults ([3d17d68](https://github.com/maziarzamani/spaceduck/commit/3d17d6828d5b16b078eebd74e21c9cc5ac4aad15))
* **config:** add 4 config API routes with ETag plumbing ([2b038fc](https://github.com/maziarzamani/spaceduck/commit/2b038fc183dbac08f947c47d4c81e2f80a41a465))
* **config:** add canonicalize for stable JSON stringify ([07af4f0](https://github.com/maziarzamani/spaceduck/commit/07af4f0f1c2b691ea1fca56b9d2a938ae36c7688))
* **config:** add capabilities module (env detection + configured status) ([bdfeb0c](https://github.com/maziarzamani/spaceduck/commit/bdfeb0cabb59dbad65b4afc9c761ca09dc3554a3))
* **config:** add config_get and config_set chat tools ([46dad2d](https://github.com/maziarzamani/spaceduck/commit/46dad2d53d6cbca3e7bb552a1100269980c5647b))
* **config:** add HOT_APPLY_PATHS and classifyOps for restart detection ([95c81ec](https://github.com/maziarzamani/spaceduck/commit/95c81ecce4e9d5c2692336714bcf4d727e3a8235))
* **config:** add JSON Pointer validation and decoding (RFC 6901) ([8255f09](https://github.com/maziarzamani/spaceduck/commit/8255f0993d9b8deaa54080549debc5e2c84ce3f2))
* **config:** implement applyPatch with replace and add ops ([67599bd](https://github.com/maziarzamani/spaceduck/commit/67599bd602ca8aa6867d67d81519619604dc86b6))
* **config:** implement ConfigStore with atomic writes and rev hashing ([196e97e](https://github.com/maziarzamani/spaceduck/commit/196e97e0f95b878dff6c559c6fbe4028adab6ea1))
* **config:** implement SECRET_PATHS, isSecretPath, getSecretStatus, redactConfig ([b35d4e9](https://github.com/maziarzamani/spaceduck/commit/b35d4e95a1c7188484809bd9f5714d3b3aad1f28))
* **config:** wire ConfigStore into createGateway ([b64244e](https://github.com/maziarzamani/spaceduck/commit/b64244e0f1c86c162106f250138648375cdd4eb9))
* **gateway:** hot-swap AI provider on config change without restart ([4865b39](https://github.com/maziarzamani/spaceduck/commit/4865b398461f19f918f9ea942679bf040d35ac9b))
* **ui:** add Settings preference pane with sidebar navigation ([31feec5](https://github.com/maziarzamani/spaceduck/commit/31feec5c0a6cf21a1149ceba0fa7bd4d450ffde9))


### Bug Fixes

* **config:** remove env fallbacks for API keys, add requireKey guard ([455ca2d](https://github.com/maziarzamani/spaceduck/commit/455ca2da50bd528576b3f0a939341f8f2ddfc712))

## [0.10.0](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.9.0...spaceduck-v0.10.0) (2026-02-20)


### Features

* add voice dictation via local Whisper STT ([e590081](https://github.com/maziarzamani/spaceduck/commit/e590081616993a1a56f9fd7e1a1f339e0e34cf14))
* improve voice dictation UX with live waveform and web app support ([18665a4](https://github.com/maziarzamani/spaceduck/commit/18665a45849131c2d5dd4e5d2d9e42e7b30eb34e))

## [0.9.0](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.8.1...spaceduck-v0.9.0) (2026-02-19)


### Features

* fix cross-conversation fact memory with slot-based conflict resolution ([80dfccf](https://github.com/maziarzamani/spaceduck/commit/80dfccf195d02a0db81562bc1ab5a5e556ab0577))

## [0.8.1](https://github.com/maziarzamani/spaceduck/compare/spaceduck-v0.8.0...spaceduck-v0.8.1) (2026-02-19)


### Bug Fixes

* cast Uint8Array to BlobPart in upload tests for stricter TS envs ([4fe55c8](https://github.com/maziarzamani/spaceduck/commit/4fe55c80d203bdddd2abf1135332fd26b9f2b6cc))
* treat WhatsApp conflict:replaced as fatal, stop retrying entirely ([0e8147f](https://github.com/maziarzamani/spaceduck/commit/0e8147f080e95d249efe66d27e1dd22aabf5bf78))

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
