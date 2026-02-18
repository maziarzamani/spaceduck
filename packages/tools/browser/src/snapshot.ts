// Aria snapshot parser: converts Playwright's ariaSnapshot() YAML output
// into a compact, LLM-friendly format with numbered interactive element refs.

import type { RefEntry } from "./types";

const INTERACTIVE_ROLES = new Set([
  "link",
  "button",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
]);

const STRUCTURAL_ROLES = new Set([
  "heading",
  "banner",
  "navigation",
  "main",
  "complementary",
  "contentinfo",
  "region",
  "article",
  "section",
  "form",
  "dialog",
  "alert",
  "status",
  "figure",
]);

const SKIP_ROLES = new Set([
  "rowgroup",
  "text",
  "paragraph",
  "table",
  "row",
  "cell",
  "list",
  "listitem",
  "img",
  "separator",
  "presentation",
  "none",
  "generic",
]);

export interface SnapshotParseResult {
  text: string;
  refs: Map<number, RefEntry>;
}

/**
 * Parse Playwright ariaSnapshot YAML into numbered refs + compact text.
 * Interactive elements get `[N] Role "name"` format.
 * Structural elements shown for context without numbers.
 */
export function parseAriaSnapshot(
  yaml: string,
  pageUrl: string,
  pageTitle: string,
  maxChars: number,
): SnapshotParseResult {
  const refs = new Map<number, RefEntry>();
  let nextRef = 1;

  const lines: string[] = [];
  lines.push(`Page: ${pageUrl}`);
  lines.push(`Title: ${pageTitle}`);
  lines.push("");

  for (const rawLine of yaml.split("\n")) {
    const stripped = rawLine.replace(/^(\s*)-\s*/, "");
    if (!stripped) continue;

    // Skip /url: metadata lines
    if (stripped.startsWith("/url:") || stripped.startsWith("- /url:")) continue;

    // Parse: `role "name" [attrs]: trailing`
    const roleMatch = stripped.match(
      /^(\w[\w-]*)\s*(?:"([^"]*)")?(?:\s*\[([^\]]+)\])?\s*:?\s*(.*)$/,
    );
    if (!roleMatch) continue;

    const [, role, name, attrs, trailing] = roleMatch;

    if (SKIP_ROLES.has(role)) continue;

    // Flatten deep nesting -- cap at 3 levels for readability
    const indentMatch = rawLine.match(/^(\s*)/);
    const rawDepth = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;
    const depth = Math.min(rawDepth, 3);
    const indent = "  ".repeat(depth);

    if (INTERACTIVE_ROLES.has(role)) {
      const displayName = name || trailing || "";
      if (!displayName) continue;

      const ref = nextRef++;
      refs.set(ref, { role, name: displayName });

      let label = `${indent}[${ref}] ${capitalize(role)}`;
      if (displayName) label += ` "${displayName}"`;
      if (attrs) label += ` [${attrs}]`;
      lines.push(label);
    } else if (STRUCTURAL_ROLES.has(role)) {
      let label = `${indent}${capitalize(role)}`;
      if (name) label += ` "${name}"`;
      if (attrs) label += ` [${attrs}]`;
      lines.push(label);
    }
  }

  let text = lines.join("\n");
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + "\n[truncated]";
  }

  return { text, refs };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
