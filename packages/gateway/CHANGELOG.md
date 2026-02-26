# Changelog

## [0.19.0](https://github.com/maziarzamani/spaceduck/compare/gateway-v0.18.0...gateway-v0.19.0) (2026-02-26)


### Features

* **desktop:** add Fn key dictation with CGEventTap health recovery ([d4eb622](https://github.com/maziarzamani/spaceduck/commit/d4eb6226767cee9ea874b0ddec68150a22a0f8f5))
* unified brand tokens, dictation pill, and agent improvements ([85bb759](https://github.com/maziarzamani/spaceduck/commit/85bb75921429d208b9a6614e01693d62530b27bd))

## [0.18.0](https://github.com/maziarzamani/spaceduck/compare/gateway-v0.17.0...gateway-v0.18.0) (2026-02-24)


### Features

* add browser and web fetch tools to settings UI ([d867d02](https://github.com/maziarzamani/spaceduck/commit/d867d02ff782b17bfd51b74b5dcd77e70b2e4da6))
* chart rendering in conversations + collapsible thinking blocks ([fee7b37](https://github.com/maziarzamani/spaceduck/commit/fee7b3705301415014900705e4719645bc53ab81))
* tool and channel hot-swap via config store ([46977a8](https://github.com/maziarzamani/spaceduck/commit/46977a8ae0e25771f177f252a3213ea0dc876431))
* tool runtime error surfacing (PR B) ([81d2a83](https://github.com/maziarzamani/spaceduck/commit/81d2a837de32914c3fc28dae9d7239144d9f4065))


### Bug Fixes

* use OS-assigned ports in gateway tests to eliminate flaky port collisions ([6bce5d9](https://github.com/maziarzamani/spaceduck/commit/6bce5d903c34279eacd1f3f7b5e13d476d0118de))

## [0.17.0](https://github.com/maziarzamani/spaceduck/compare/gateway-v0.16.0...gateway-v0.17.0) (2026-02-24)


### Features

* add CLI for config management + fix hot-apply tests + update README ([7e8ed5c](https://github.com/maziarzamani/spaceduck/commit/7e8ed5c7a457382a87488ac00025908147331dee))
* add default system prompt for new and existing installations ([e1e66e9](https://github.com/maziarzamani/spaceduck/commit/e1e66e920e218495ad8d409285bc14f212e93402))
* add embedding settings to UI and wire factory to product config ([093ae73](https://github.com/maziarzamani/spaceduck/commit/093ae73f97a8b8c24d5a2785e04d772d3a087abb))
* add gateway pairing and token authentication (Slice 1) ([6edc6c3](https://github.com/maziarzamani/spaceduck/commit/6edc6c3e856a7afc51b43a157d2372f9cc043fc5))
* add PDF document scanning via Marker and file upload infrastructure ([ff2816d](https://github.com/maziarzamani/spaceduck/commit/ff2816d12ffad4e4f3ab9e4145447c030b8baeb7))
* add voice dictation via local Whisper STT ([e590081](https://github.com/maziarzamani/spaceduck/commit/e590081616993a1a56f9fd7e1a1f339e0e34cf14))
* **config:** add 4 config API routes with ETag plumbing ([2b038fc](https://github.com/maziarzamani/spaceduck/commit/2b038fc183dbac08f947c47d4c81e2f80a41a465))
* **config:** add capabilities module (env detection + configured status) ([bdfeb0c](https://github.com/maziarzamani/spaceduck/commit/bdfeb0cabb59dbad65b4afc9c761ca09dc3554a3))
* **config:** add config_get and config_set chat tools ([46dad2d](https://github.com/maziarzamani/spaceduck/commit/46dad2d53d6cbca3e7bb552a1100269980c5647b))
* **config:** implement ConfigStore with atomic writes and rev hashing ([196e97e](https://github.com/maziarzamani/spaceduck/commit/196e97e0f95b878dff6c559c6fbe4028adab6ea1))
* **config:** wire ConfigStore into createGateway ([b64244e](https://github.com/maziarzamani/spaceduck/commit/b64244e0f1c86c162106f250138648375cdd4eb9))
* fix cross-conversation fact memory with slot-based conflict resolution ([80dfccf](https://github.com/maziarzamani/spaceduck/commit/80dfccf195d02a0db81562bc1ab5a5e556ab0577))
* **gateway:** hot-swap AI provider on config change without restart ([4865b39](https://github.com/maziarzamani/spaceduck/commit/4865b398461f19f918f9ea942679bf040d35ac9b))
* harden memory pipeline — slot deactivation, contamination guard, multilingual extraction ([9ce9940](https://github.com/maziarzamani/spaceduck/commit/9ce99405d5b46a869941e7eb35457faddd9ffe75))
* improve voice dictation UX with live waveform and web app support ([18665a4](https://github.com/maziarzamani/spaceduck/commit/18665a45849131c2d5dd4e5d2d9e42e7b30eb34e))
* independent versioning for gateway and CLI with API compatibility contract ([109f049](https://github.com/maziarzamani/spaceduck/commit/109f0496dee0b8c4c74d66a7b6a8f77055135493))
* initial release — memory v2, bedrock, web UI, whatsapp ([e97997f](https://github.com/maziarzamani/spaceduck/commit/e97997f69b660cab4ad37b8458933f4badffe74b))
* onboarding setup wizard, UI polish, and chat UX improvements ([4005fa0](https://github.com/maziarzamani/spaceduck/commit/4005fa0019d771d823e91338d671811c7b65c1c6))
* opener plugin, pairing UX improvements, and external link handling ([69dced7](https://github.com/maziarzamani/spaceduck/commit/69dced735d1212d0e355c0683b6fa3fb45900d9d))
* shared UI architecture — web + desktop from one codebase ([ec01c71](https://github.com/maziarzamani/spaceduck/commit/ec01c714365d5430424455503999dfd8371de3e4))
* **tools:** add web_search + web_answer tools with Brave, Perplexity, SearXNG ([042c6ef](https://github.com/maziarzamani/spaceduck/commit/042c6ef0eb35d4e720682f24573bc6d32682417c))


### Bug Fixes

* cast Uint8Array to BlobPart in upload tests for stricter TS envs ([4fe55c8](https://github.com/maziarzamani/spaceduck/commit/4fe55c80d203bdddd2abf1135332fd26b9f2b6cc))
* **config:** remove env fallbacks for API keys, add requireKey guard ([455ca2d](https://github.com/maziarzamani/spaceduck/commit/455ca2da50bd528576b3f0a939341f8f2ddfc712))
* make PDF upload test independent of marker_single on PATH ([609603a](https://github.com/maziarzamani/spaceduck/commit/609603a6236bd9150eddd32ec1f538e9e732aa41))
* resolve pre-existing type errors in gateway and ui ([b85ead3](https://github.com/maziarzamani/spaceduck/commit/b85ead300882ced378ef08033b45bb5480e02f36))
* **ui:** filter tool messages from history, add target=_blank to markdown links ([900c89e](https://github.com/maziarzamani/spaceduck/commit/900c89e2036909f713d397bf6f91c366d60abfd3))
* update test regex to match new /pair page HTML structure ([99e56cd](https://github.com/maziarzamani/spaceduck/commit/99e56cde8a094c99817ba3be159bcf1894d54eda))
