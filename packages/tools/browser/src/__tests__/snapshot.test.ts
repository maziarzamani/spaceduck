import { describe, test, expect } from "bun:test";
import { parseAriaSnapshot, type SnapshotParseResult } from "../snapshot";

function parse(yaml: string, maxChars = 10000): SnapshotParseResult {
  return parseAriaSnapshot(yaml, "https://example.com", "Test Page", maxChars);
}

describe("parseAriaSnapshot", () => {
  test("includes page URL and title in output", () => {
    const result = parse("");
    expect(result.text).toContain("https://example.com");
    expect(result.text).toContain("Test Page");
  });

  test("assigns numbered refs to interactive elements", () => {
    const yaml = `- link "Home"\n- button "Submit"\n- textbox "Email"`;
    const result = parse(yaml);

    expect(result.refs.size).toBe(3);
    expect(result.text).toContain('[1] Link "Home"');
    expect(result.text).toContain('[2] Button "Submit"');
    expect(result.text).toContain('[3] Textbox "Email"');
  });

  test("shows structural roles without ref numbers", () => {
    const yaml = `- heading "Welcome"\n- navigation "Main Nav"\n- main "Content"`;
    const result = parse(yaml);

    expect(result.refs.size).toBe(0);
    expect(result.text).toContain('Heading "Welcome"');
    expect(result.text).toContain('Navigation "Main Nav"');
    expect(result.text).toContain('Main "Content"');
    expect(result.text).not.toMatch(/\[\d+\] Heading/);
  });

  test("skips elements with SKIP_ROLES", () => {
    const yaml = `- text "hello"\n- paragraph "content"\n- generic "div"\n- list "items"\n- listitem "item1"`;
    const result = parse(yaml);

    expect(result.text).not.toContain("hello");
    expect(result.text).not.toContain("content");
    expect(result.refs.size).toBe(0);
  });

  test("handles interactive elements with attributes", () => {
    const yaml = `- checkbox "Remember me" [checked]`;
    const result = parse(yaml);

    expect(result.text).toContain('[1] Checkbox "Remember me" [checked]');
    expect(result.refs.get(1)).toEqual({ role: "checkbox", name: "Remember me" });
  });

  test("skips /url: metadata lines", () => {
    const yaml = `/url: https://example.com\n- button "Click"`;
    const result = parse(yaml);

    expect(result.text).not.toContain("/url:");
    expect(result.refs.size).toBe(1);
  });

  test("handles various interactive roles", () => {
    const yaml = [
      '- searchbox "Search"',
      '- combobox "Select"',
      '- option "Option 1"',
      '- radio "Choice A"',
      '- switch "Dark mode"',
      '- tab "Settings"',
      '- menuitem "Edit"',
    ].join("\n");

    const result = parse(yaml);
    expect(result.refs.size).toBe(7);
  });

  test("caps indentation at 3 levels", () => {
    const yaml = `            - button "Deep"`;  // 12 spaces = depth 6
    const result = parse(yaml);

    // Should be capped at 3 levels = 6 spaces
    const buttonLine = result.text.split("\n").find((l) => l.includes("Button"));
    expect(buttonLine).toBeDefined();
    const leadingSpaces = buttonLine!.match(/^(\s*)/)?.[1].length ?? 0;
    expect(leadingSpaces).toBeLessThanOrEqual(6);
  });

  test("truncates output that exceeds maxChars", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `- button "Button ${i}"`).join("\n");
    const result = parse(lines, 200);

    expect(result.text.length).toBeLessThanOrEqual(220);
    expect(result.text).toContain("[truncated]");
  });

  test("skips interactive elements with no display name", () => {
    const yaml = `- button ""\n- link ""`;
    const result = parse(yaml);
    expect(result.refs.size).toBe(0);
  });

  test("uses trailing text as display name when no quoted name", () => {
    const yaml = `- button : Click here`;
    const result = parse(yaml);

    if (result.refs.size > 0) {
      expect(result.refs.get(1)?.name).toBe("Click here");
    }
  });

  test("populates ref entries with correct role and name", () => {
    const yaml = `- link "GitHub"\n- textbox "Username"`;
    const result = parse(yaml);

    expect(result.refs.get(1)).toEqual({ role: "link", name: "GitHub" });
    expect(result.refs.get(2)).toEqual({ role: "textbox", name: "Username" });
  });

  test("handles structural roles with attributes", () => {
    const yaml = `- dialog "Confirm" [modal]`;
    const result = parse(yaml);

    expect(result.text).toContain('Dialog "Confirm" [modal]');
  });
});
