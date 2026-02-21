import { describe, expect, test } from "bun:test";
import { validatePointer, decodePointer, PointerError } from "../pointer";

describe("validatePointer", () => {
  test("accepts valid pointers", () => {
    expect(() => validatePointer("/ai/model")).not.toThrow();
    expect(() => validatePointer("/ai/secrets/geminiApiKey")).not.toThrow();
    expect(() => validatePointer("/version")).not.toThrow();
    expect(() => validatePointer("/tools/webSearch/searxngUrl")).not.toThrow();
  });

  test("rejects empty string", () => {
    expect(() => validatePointer("")).toThrow(PointerError);
  });

  test("rejects missing leading slash", () => {
    expect(() => validatePointer("ai/model")).toThrow(PointerError);
  });

  test("rejects bare slash (no segments)", () => {
    expect(() => validatePointer("/")).toThrow(PointerError);
  });

  test("rejects trailing slash (empty segment)", () => {
    expect(() => validatePointer("/ai/model/")).toThrow(PointerError);
  });

  test("rejects double slash (empty segment)", () => {
    expect(() => validatePointer("/ai//model")).toThrow(PointerError);
  });

  test("rejects invalid ~ escape", () => {
    expect(() => validatePointer("/a/~2b")).toThrow(PointerError);
    expect(() => validatePointer("/a/~")).toThrow(PointerError);
  });

  test("accepts valid ~ escapes", () => {
    expect(() => validatePointer("/a/~0b")).not.toThrow();
    expect(() => validatePointer("/a/~1b")).not.toThrow();
  });
});

describe("decodePointer", () => {
  test("decodes simple paths", () => {
    expect(decodePointer("/ai/model")).toEqual(["ai", "model"]);
    expect(decodePointer("/version")).toEqual(["version"]);
    expect(decodePointer("/tools/webSearch/secrets/braveApiKey")).toEqual([
      "tools", "webSearch", "secrets", "braveApiKey",
    ]);
  });

  test("decodes ~1 as /", () => {
    expect(decodePointer("/a/~1model")).toEqual(["a", "/model"]);
  });

  test("decodes ~0 as ~", () => {
    expect(decodePointer("/a/~0tilde")).toEqual(["a", "~tilde"]);
  });

  test("decodes combined escapes", () => {
    expect(decodePointer("/~0~1")).toEqual(["~/"])
  });

  test("validates before decoding", () => {
    expect(() => decodePointer("bad")).toThrow(PointerError);
  });
});
