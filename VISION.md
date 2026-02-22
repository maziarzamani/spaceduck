# Spaceduck Vision

Spaceduck is a personal AI assistant that runs locally or connects to cloud models.
It is designed to feel trustworthy, fast, and always available, while keeping the user in control.

## The problem

AI assistants today are often tied to a single vendor, poor at long-term continuity, and unsafe to connect to real-world tools without guardrails. Memory is fragile or invisible. Switching models means switching products.

Spaceduck exists to fix that: a personal assistant that compounds over time and remains user-owned.

## Core principles

### 1. User control over data

Spaceduck runs where your data lives. Local-first is a default posture, not a moral stance. If you choose cloud providers, it should be explicit and visible. All data stays in a single SQLite database on your machine.

### 2. Memory must be correctable

Memory is not magic. It is a system with inspectable state, explicit updates, and correction semantics. Corrections always win — saying "my name is now Peter" deactivates the old value. Assistant-generated text can never overwrite user identity (contamination guard).

### 3. One gateway, many clients

The gateway is the control plane. Clients (Web UI, Desktop app, CLI, WhatsApp) are thin surfaces over the same HTTP/WebSocket API. Adding a new client should not require changing the gateway.

### 4. Provider-agnostic by design

Chat and embeddings are independent subsystems. It should be easy to mix local chat with cloud embeddings, cloud chat with local embeddings, or two local servers on separate ports. Switching providers should take seconds, not migrations.

### 5. Tools are powerful, therefore visible

Tool usage must be transparent (the user sees what ran), scoped (not everything is enabled by default), and safe (errors are surfaced as text, not swallowed). Tool results are plain strings the LLM can read — no hidden schemas.

### 6. Ship in slices

Small, shippable increments beat big rewrites. Tests and deterministic behavior (regex extraction, transactional upserts, SHA-256 dedup) provide confidence. E2E tests run against real models.

## What good looks like (12–18 months)

A Spaceduck user can:

- Talk to their assistant from Web, Desktop, CLI, and at least one messaging channel
- Trust that it remembers key facts, inspect them, and correct them easily
- Connect any model provider (local or cloud) in minutes
- Browse, fetch, and parse documents with clear tool traces
- Run the gateway locally or on a server and use clients safely from anywhere

## Anti-goals

- A black-box memory that can't be inspected or corrected
- Vendor lock-in to a single model API
- Making every feature depend on an LLM decision when deterministic logic works
- Tool execution without user visibility
- "Everything is a plugin" complexity before the core is solid

## Vocabulary

| Term | Meaning |
|------|---------|
| **Gateway** | The local HTTP/WebSocket server — the engine that runs everything |
| **Client** | Any surface that connects to the gateway (Web UI, Desktop, CLI, WhatsApp) |
| **Model Provider** | Where a model runs — local (llama.cpp, LM Studio) or cloud (Bedrock, Gemini, OpenRouter) |
| **Memory Search** | The system that stores, indexes, and recalls facts across conversations |
| **Slot** | A named identity category (name, age, location) with "only one active" semantics |
| **Hot-apply** | A config change that takes effect without restarting the gateway |

## Where to go next

- [Docs](https://spaceduck.mintlify.app)
- [Quickstart](https://spaceduck.mintlify.app/quickstart)
- [Issues](https://github.com/maziarzamani/spaceduck/issues)
