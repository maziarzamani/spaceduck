import { describe, test, expect } from "bun:test";
import { ThinkStripper } from "../think-stripper";

describe("ThinkStripper", () => {
  test("passes through normal text unchanged", () => {
    const s = new ThinkStripper();
    expect(s.feed("Hello world")).toBe("Hello world");
    expect(s.flush()).toBe("");
  });

  test("strips a complete think block in one chunk", () => {
    const s = new ThinkStripper();
    expect(s.feed("<think>reasoning here</think>answer")).toBe("answer");
    expect(s.flush()).toBe("");
  });

  test("strips a think block split across chunks", () => {
    const s = new ThinkStripper();
    expect(s.feed("<think>reason")).toBe("");
    expect(s.feed("ing</think>answer")).toBe("answer");
    expect(s.flush()).toBe("");
  });

  test("discards unclosed think block at flush", () => {
    const s = new ThinkStripper();
    s.feed("<think>never closed");
    expect(s.flush()).toBe("");
  });

  test("handles text before and after think block", () => {
    const s = new ThinkStripper();
    const out = s.feed("before<think>hidden</think>after");
    expect(out).toBe("beforeafter");
  });

  test("handles a split opening tag across chunks", () => {
    const s = new ThinkStripper();
    // "<thin" followed by "k>hidden</think>visible"
    expect(s.feed("<thin")).toBe("");
    expect(s.feed("k>hidden</think>visible")).toBe("visible");
  });
});
