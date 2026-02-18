---
name: add-tool
description: Scaffold a new agent tool package for spaceduck
---

# Add Tool

Scaffolds a new agent tool under `packages/tools/<name>/`.

## Steps

1. Ask for the tool name (e.g., "web-search", "shell-exec", "file-read")
2. Create the directory structure:

```
packages/tools/<name>/
  package.json          # @spaceduck/tool-<name>
  src/
    <name>-tool.ts      # main tool class
    types.ts            # (optional) interfaces/options
    index.ts            # barrel export
    __tests__/
      <name>.test.ts    # bun:test suite
```

3. Create `package.json`:

```json
{
  "name": "@spaceduck/tool-<name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "test": "bun test" },
  "dependencies": {},
  "devDependencies": { "bun-types": "latest" }
}
```

4. The tool class must follow this pattern:

```typescript
export interface <Name>ToolOptions {
  maxChars?: number;    // default 50,000
  // tool-specific options with sensible defaults
}

export class <Name>Tool {
  constructor(options: <Name>ToolOptions = {}) { /* ... */ }

  // Public methods return Promise<string> -- the text the LLM will see
  async doSomething(args: ...): Promise<string> { /* ... */ }
}
```

5. Key conventions:
   - Constructor accepts an options object with sensible defaults
   - All public methods return `Promise<string>` (tool results are always text for the LLM)
   - Return error descriptions as strings -- never throw. The LLM needs to read failures
   - Truncate large outputs at `maxChars` (default 50,000) with `[truncated]` marker
   - Include context headers in results (e.g., `URL:`, `Title:`, `File:`)

6. Write tests in `src/__tests__/<name>.test.ts`:
   - Import from `..` (the barrel)
   - Test happy path, error handling, and truncation
   - Use `describe`/`it`/`expect` from `bun:test`

7. Run `bun install` from root to link the new workspace
8. Run `bun test packages/tools/<name>/` to verify
9. Export from `src/index.ts`:

```typescript
export { <Name>Tool, type <Name>ToolOptions } from "./<name>-tool";
```

## Reference

See existing tools for examples:
- `packages/tools/browser/` -- heavyweight Playwright browser automation
- `packages/tools/web-fetch/` -- lightweight HTTP fetch + HTML-to-text
