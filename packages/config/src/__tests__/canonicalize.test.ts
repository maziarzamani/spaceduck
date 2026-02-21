import { describe, expect, test } from "bun:test";
import { canonicalize } from "../canonicalize";

describe("canonicalize", () => {
  test("sorts object keys alphabetically", () => {
    const result = canonicalize({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  test("sorts nested object keys", () => {
    const result = canonicalize({ b: { z: 1, a: 2 }, a: 1 });
    expect(result).toBe('{"a":1,"b":{"a":2,"z":1}}');
  });

  test("preserves array order (does NOT sort arrays)", () => {
    const result = canonicalize({ items: [3, 1, 2] });
    expect(result).toBe('{"items":[3,1,2]}');
  });

  test("deep-sorts keys inside array elements", () => {
    const result = canonicalize([{ z: 1, a: 2 }]);
    expect(result).toBe('[{"a":2,"z":1}]');
  });

  test("converts undefined to null", () => {
    const result = canonicalize({ a: undefined });
    expect(result).toBe('{"a":null}');
  });

  test("preserves null", () => {
    const result = canonicalize({ a: null });
    expect(result).toBe('{"a":null}');
  });

  test("handles primitives", () => {
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize("hello")).toBe('"hello"');
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(null)).toBe("null");
  });

  test("produces same output regardless of insertion order", () => {
    const a = canonicalize({ ai: { model: "x", provider: "gemini" }, version: 1 });
    const b = canonicalize({ version: 1, ai: { provider: "gemini", model: "x" } });
    expect(a).toBe(b);
  });
});
