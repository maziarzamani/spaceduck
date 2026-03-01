import { describe, it, expect } from "bun:test";
import { parseSkillMd } from "../parser";

describe("parseSkillMd", () => {
  it("parses a valid SKILL.md with required fields", () => {
    const content = `---
name: test-skill
description: A test skill for unit testing.
---

# Test Skill

Do something useful.`;

    const result = parseSkillMd(content, "/tmp/test/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.id).toBe("test-skill");
    expect(result.manifest.description).toBe("A test skill for unit testing.");
    expect(result.manifest.instructions).toBe("# Test Skill\n\nDo something useful.");
    expect(result.manifest.filePath).toContain("SKILL.md");
  });

  it("parses spaceduck extensions (toolAllow, budget fields)", () => {
    const content = `---
name: scoped-skill
description: Skill with tool scoping.
toolAllow: [web_search, web_fetch]
maxTokens: 5000
maxCostUsd: 0.10
---

Use web_search to find answers.`;

    const result = parseSkillMd(content, "/tmp/scoped/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.toolAllow).toEqual(["web_search", "web_fetch"]);
    expect(result.manifest.budget?.maxTokens).toBe(5000);
    expect(result.manifest.budget?.maxCostUsd).toBe(0.1);
  });

  it("preserves unknown OpenClaw fields in extra", () => {
    const content = `---
name: openclaw-skill
description: An OpenClaw skill with extra fields.
tools: [bash, browser]
model: gpt-4
provider: openai
---

OpenClaw instructions here.`;

    const result = parseSkillMd(content, "/tmp/openclaw/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.extra.tools).toEqual(["bash", "browser"]);
    expect(result.manifest.extra.model).toBe("gpt-4");
    expect(result.manifest.extra.provider).toBe("openai");
  });

  it("rejects missing frontmatter", () => {
    const content = "# No frontmatter\n\nJust markdown.";
    const result = parseSkillMd(content, "/tmp/bad/SKILL.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NO_FRONTMATTER");
  });

  it("rejects missing name field", () => {
    const content = `---
description: Missing name.
---

Instructions.`;

    const result = parseSkillMd(content, "/tmp/noname/SKILL.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MISSING_NAME");
  });

  it("rejects missing description field", () => {
    const content = `---
name: no-desc
---

Instructions.`;

    const result = parseSkillMd(content, "/tmp/nodesc/SKILL.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MISSING_DESCRIPTION");
  });

  it("rejects empty body", () => {
    const content = `---
name: empty-body
description: Skill with no instructions.
---
`;

    const result = parseSkillMd(content, "/tmp/empty/SKILL.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EMPTY_BODY");
  });

  it("parses version and author fields", () => {
    const content = `---
name: versioned
description: A versioned skill.
version: "1.2.3"
author: maziar
---

Instructions here.`;

    const result = parseSkillMd(content, "/tmp/versioned/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.version).toBe("1.2.3");
    expect(result.manifest.author).toBe("maziar");
  });

  it("handles quoted string values", () => {
    const content = `---
name: "quoted-name"
description: "A skill with quoted values."
---

Body text.`;

    const result = parseSkillMd(content, "/tmp/quoted/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("quoted-name");
    expect(result.manifest.description).toBe("A skill with quoted values.");
  });
});
