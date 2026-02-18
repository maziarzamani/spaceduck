# Contributing to Spaceduck

Welcome. Spaceduck is a personal AI assistant built from scratch — no agent frameworks, no orchestration wrappers. Every layer is handwritten TypeScript on Bun, and contributions that keep it that way are exactly what we're looking for.

## Quick links

- [Vision](VISION.md) — where the project is going
- [Security](SECURITY.md) — how to report vulnerabilities
- [Roadmap](README.md#roadmap) — what's being built next

## Before you open a PR

1. **Bugs and small fixes** — open a PR directly
2. **New features or architecture changes** — open an issue or discussion first so we can align before you invest time writing code
3. **Questions** — open a discussion

One PR = one topic. Do not bundle unrelated fixes or features. PRs over 500 changed lines get extra review time; if yours is large, explain why in the description.

## Branching (Gitflow)

| Branch | Purpose |
|--------|---------|
| `main` | Tagged releases only — never commit directly |
| `develop` | Integration — all features land here |
| `feature/*` | New work — branch from and PR back to `develop` |
| `release/*` | Release prep — from `develop`, merges to `main` + `develop` |
| `hotfix/*` | Urgent fixes — from `main`, merges to `main` + `develop` |

### Day-to-day workflow

1. `git checkout develop && git pull`
2. `git checkout -b feature/your-thing`
3. Commit with conventional prefixes (`feat:`, `fix:`, `chore:`…)
4. Push and open a PR targeting `develop`
5. CI passes → auto-approved → merge

## Local setup

**Prerequisites:** [Bun](https://bun.sh) v1.3+, an LLM provider (local or cloud)

```bash
git clone https://github.com/maziarzamani/spaceduck.git
cd spaceduck
bun install

# For the browser tool (one-time)
bunx playwright install chromium

# For sqlite-vec on macOS — install SQLite with extension support (one-time)
brew install sqlite

# Configure
cp .env.example .env
# Edit .env — set your provider and API keys

# Run
bun run dev
```

## Commit format

Spaceduck uses [Conventional Commits](https://www.conventionalcommits.org). The release pipeline reads commit prefixes to determine version bumps and generate changelogs automatically.

| Prefix | When to use | Version bump |
|--------|-------------|--------------|
| `feat:` | New capability visible to users | minor |
| `fix:` | Bug fix | patch |
| `chore:` | Tooling, deps, config — no user impact | none |
| `docs:` | Documentation only | none |
| `refactor:` | Internal restructure, no behavior change | none |
| `test:` | Tests only | none |
| `perf:` | Performance improvement | patch |

For breaking changes, add `BREAKING CHANGE:` in the commit body or append `!` to the type: `feat!:`.

## Running tests

```bash
bun test --recursive           # all tests
bun test packages/core/        # unit tests
bun test packages/memory/      # memory + vector tests
bun run typecheck              # TypeScript type check
bun run build                  # verify build compiles
```

All tests must pass and `typecheck` must be clean before a PR can merge.

## Extension points

Spaceduck has three clean extension points. Each follows the same pattern: implement an interface, register it in the gateway.

### Adding a provider

Implement `Provider` (chat streaming) and/or `EmbeddingProvider` from `@spaceduck/core`:

```
packages/providers/<name>/
├── package.json
└── src/
    ├── index.ts        # re-exports
    └── provider.ts     # implements Provider
```

See `packages/providers/gemini/` for a reference implementation.

### Adding a channel

Implement the `Channel` interface from `@spaceduck/core`:

```
packages/channels/<name>/
├── package.json
└── src/
    ├── index.ts
    └── <name>-channel.ts   # implements Channel
```

See `packages/channels/whatsapp/` for a reference implementation.

### Adding a tool

Implement a tool class and register it in `packages/gateway/src/tool-registrations.ts`. See `packages/tools/browser/` for an example.

## AI-assisted PRs welcome

Built with Cursor, Claude, Codex, or another AI tool? That is perfectly fine — just be transparent about it:

- Note in your PR description that it is AI-assisted
- Confirm you understand what the code does and have reviewed the diff
- Include the prompts or session context if it helps reviewers understand decisions

AI-generated code is held to exactly the same quality bar as human-written code.

## PR checklist

Before submitting, verify:

- [ ] `bun test --recursive` passes
- [ ] `bun run typecheck` is clean
- [ ] `bun run build` succeeds
- [ ] Commit messages follow the conventional commit format
- [ ] One topic per PR
