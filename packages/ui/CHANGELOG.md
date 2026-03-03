# Changelog

## [0.3.0](https://github.com/maziarzamani/spaceduck/compare/ui-v0.2.0...ui-v0.3.0) (2026-03-03)


### Features

* add browser and web fetch tools to settings UI ([d867d02](https://github.com/maziarzamani/spaceduck/commit/d867d02ff782b17bfd51b74b5dcd77e70b2e4da6))
* add default system prompt for new and existing installations ([e1e66e9](https://github.com/maziarzamani/spaceduck/commit/e1e66e920e218495ad8d409285bc14f212e93402))
* add embedding settings to UI and wire factory to product config ([093ae73](https://github.com/maziarzamani/spaceduck/commit/093ae73f97a8b8c24d5a2785e04d772d3a087abb))
* add PDF document scanning via Marker and file upload infrastructure ([ff2816d](https://github.com/maziarzamani/spaceduck/commit/ff2816d12ffad4e4f3ab9e4145447c030b8baeb7))
* add view router, extract ChatView, and add shadcn primitives (Slice 2) ([5329fdc](https://github.com/maziarzamani/spaceduck/commit/5329fdc64a1c9bfed7fa9d40a1f6d283153863c9))
* add voice dictation via local Whisper STT ([e590081](https://github.com/maziarzamani/spaceduck/commit/e590081616993a1a56f9fd7e1a1f339e0e34cf14))
* agent dashboard UI, task creation, skill execution fixes ([1e49c11](https://github.com/maziarzamani/spaceduck/commit/1e49c11df87472d110b4bac5faecf0a40292f5c9))
* **browser:** add live preview panel with CDP screencast streaming ([b18455f](https://github.com/maziarzamani/spaceduck/commit/b18455f58c7042f21696c732d94c91196dd60474))
* chart rendering in conversations + collapsible thinking blocks ([fee7b37](https://github.com/maziarzamani/spaceduck/commit/fee7b3705301415014900705e4719645bc53ab81))
* config input validation (PR A) ([bd88de2](https://github.com/maziarzamani/spaceduck/commit/bd88de27a352112a12228109459005f127770446))
* **desktop:** add Fn key dictation with CGEventTap health recovery ([d4eb622](https://github.com/maziarzamani/spaceduck/commit/d4eb6226767cee9ea874b0ddec68150a22a0f8f5))
* harden memory pipeline — slot deactivation, contamination guard, multilingual extraction ([9ce9940](https://github.com/maziarzamani/spaceduck/commit/9ce99405d5b46a869941e7eb35457faddd9ffe75))
* implement onboarding wizard with 5-screen pairing flow (Slice 3) ([14d8642](https://github.com/maziarzamani/spaceduck/commit/14d864267e7d0d1184feedc6ac5df96f8c67752a))
* implement settings page with device management (Slice 4) ([39a770f](https://github.com/maziarzamani/spaceduck/commit/39a770ff770459f5d56563c45b6a8d23ce2d350c))
* improve voice dictation UX with live waveform and web app support ([18665a4](https://github.com/maziarzamani/spaceduck/commit/18665a45849131c2d5dd4e5d2d9e42e7b30eb34e))
* memory viewer UI + fix version management ([3bdbf38](https://github.com/maziarzamani/spaceduck/commit/3bdbf38d801cf3a03bad39e6ca14daaceec612a4))
* onboarding setup wizard, UI polish, and chat UX improvements ([4005fa0](https://github.com/maziarzamani/spaceduck/commit/4005fa0019d771d823e91338d671811c7b65c1c6))
* opener plugin, pairing UX improvements, and external link handling ([69dced7](https://github.com/maziarzamani/spaceduck/commit/69dced735d1212d0e355c0683b6fa3fb45900d9d))
* OTP input for pairing code and clickable gateway URL ([b75a428](https://github.com/maziarzamani/spaceduck/commit/b75a42829d6271938f6bb9183666d606997b8931))
* shared UI architecture — web + desktop from one codebase ([ec01c71](https://github.com/maziarzamani/spaceduck/commit/ec01c714365d5430424455503999dfd8371de3e4))
* tool runtime error surfacing (PR B) ([81d2a83](https://github.com/maziarzamani/spaceduck/commit/81d2a837de32914c3fc28dae9d7239144d9f4065))
* **ui:** add Settings preference pane with sidebar navigation ([31feec5](https://github.com/maziarzamani/spaceduck/commit/31feec5c0a6cf21a1149ceba0fa7bd4d450ffde9))
* **ui:** per-conversation stream state map and reconnect run status ([5b66179](https://github.com/maziarzamani/spaceduck/commit/5b6617980b24d28ccc170c91a943dee9b8635edd))
* **ui:** rebuild interface with shadcn/ui components + auto-reconnect ([064d654](https://github.com/maziarzamani/spaceduck/commit/064d654062fa1e35dcabac1eb895dcdef0619c9f))
* unified brand tokens, dictation pill, and agent improvements ([85bb759](https://github.com/maziarzamani/spaceduck/commit/85bb75921429d208b9a6614e01693d62530b27bd))


### Bug Fixes

* add browser and webFetch to ConfigCapabilities type ([635141f](https://github.com/maziarzamani/spaceduck/commit/635141f9cae5a9af5a418f48ee2078831b7efa96))
* handle stale auth tokens and node:os crash in browser bundle ([cc2c7b8](https://github.com/maziarzamani/spaceduck/commit/cc2c7b84b48636eccfff0de775b6a8f6f4b69a53))
* pass initial value to useRef in memory-view to satisfy strict TypeScript ([828a626](https://github.com/maziarzamani/spaceduck/commit/828a626ece8971878adfbae5a935f12db3dcb3ad))
* resolve pre-existing type errors in gateway and ui ([b85ead3](https://github.com/maziarzamani/spaceduck/commit/b85ead300882ced378ef08033b45bb5480e02f36))
* **ui:** filter tool messages from history, add target=_blank to markdown links ([900c89e](https://github.com/maziarzamani/spaceduck/commit/900c89e2036909f713d397bf6f91c366d60abfd3))
* **ui:** isolate streaming state per conversation and add sidebar indicators ([2854f02](https://github.com/maziarzamani/spaceduck/commit/2854f024658193d8d8e1f5b5047aec6cff3d519f))
* **ui:** resolve TS error in chart-renderer pie label callback ([bbda9c6](https://github.com/maziarzamani/spaceduck/commit/bbda9c61fe35e30ebca59e8854b1499c0da8435b))
* **ws:** replace WKWebView WebSocket with Tauri Rust plugin for reliable reconnection ([cb1aebf](https://github.com/maziarzamani/spaceduck/commit/cb1aebf8829b7faf8185368752635e6b5ead07d9))
