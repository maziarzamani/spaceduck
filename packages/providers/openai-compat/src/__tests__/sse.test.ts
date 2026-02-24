import { describe, test, expect } from "bun:test";
import { processSSEBuffer } from "../sse";

// ── processSSEBuffer ────────────────────────────────────────────────────────

describe("processSSEBuffer", () => {
  test("parses a standard text chunk", () => {
    const chunk = JSON.stringify({ choices: [{ delta: { content: "Hello" } }] });
    const { events, remaining } = processSSEBuffer("", `data: ${chunk}\n\n`);
    expect(events).toContainEqual({ type: "text", text: "Hello" });
    expect(remaining).toBe("");
  });

  test("falls back to message.content if delta is absent", () => {
    const chunk = JSON.stringify({ choices: [{ message: { content: "World" } }] });
    const { events } = processSSEBuffer("", `data: ${chunk}\n\n`);
    expect(events).toContainEqual({ type: "text", text: "World" });
  });

  test("stops on [DONE]", () => {
    const { events } = processSSEBuffer("", "data: [DONE]\n\n");
    expect(events).toContainEqual({ type: "done" });
  });

  test("skips blank lines and non-data lines", () => {
    const input = "\n\n: comment\ndata: [DONE]\n\n";
    const { events } = processSSEBuffer("", input);
    expect(events).toEqual([{ type: "done" }]);
  });

  test("skips malformed JSON without throwing", () => {
    const { events } = processSSEBuffer("", "data: {not json}\n\ndata: [DONE]\n\n");
    expect(events).toEqual([{ type: "done" }]);
  });

  test("ignores extra top-level fields (timings, usage)", () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { content: "Hi" }, finish_reason: null }],
      timings: { prompt_ms: 100 },
      usage: { prompt_tokens: 5 },
    });
    const { events } = processSSEBuffer("", `data: ${chunk}\n\n`);
    expect(events).toContainEqual({ type: "text", text: "Hi" });
  });

  test("emits finish event with reason", () => {
    const chunk = JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] });
    const { events } = processSSEBuffer("", `data: ${chunk}\n\n`);
    expect(events).toContainEqual({ type: "finish", reason: "stop" });
  });

  test("emits tool_delta events", () => {
    const chunk = JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: "call_1", function: { name: "search", arguments: '{"q"' } }],
        },
      }],
    });
    const { events } = processSSEBuffer("", `data: ${chunk}\n\n`);
    expect(events).toContainEqual({
      type: "tool_delta",
      index: 0,
      id: "call_1",
      name: "search",
      arguments: '{"q"',
    });
  });

  test("accumulates split SSE lines across buffer calls", () => {
    // First call — line is incomplete (no newline yet)
    const chunk = JSON.stringify({ choices: [{ delta: { content: "Split" } }] });
    const line = `data: ${chunk}`;
    const { events: e1, remaining } = processSSEBuffer("", line);
    expect(e1).toEqual([]);
    // Second call — newline arrives
    const { events: e2 } = processSSEBuffer(remaining, "\n\n");
    expect(e2).toContainEqual({ type: "text", text: "Split" });
  });

  test("handles empty delta content gracefully", () => {
    const chunk = JSON.stringify({ choices: [{ delta: { content: null } }] });
    const { events } = processSSEBuffer("", `data: ${chunk}\n\n`);
    expect(events.filter((e) => e.type === "text")).toHaveLength(0);
  });

  test("emits reasoning event from delta.reasoning", () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { content: "", reasoning: "Let me think..." } }],
    });
    const { events } = processSSEBuffer("", `data: ${chunk}\n\n`);
    expect(events).toContainEqual({ type: "reasoning", text: "Let me think..." });
  });

  test("emits reasoning event from delta.reasoning_content", () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { content: "", reasoning_content: "Step 1: analyze" } }],
    });
    const { events } = processSSEBuffer("", `data: ${chunk}\n\n`);
    expect(events).toContainEqual({ type: "reasoning", text: "Step 1: analyze" });
  });

  test("emits reasoning event from message.reasoning fallback", () => {
    const chunk = JSON.stringify({
      choices: [{ message: { content: "", reasoning: "Thinking deeply" } }],
    });
    const { events } = processSSEBuffer("", `data: ${chunk}\n\n`);
    expect(events).toContainEqual({ type: "reasoning", text: "Thinking deeply" });
  });

  test("emits both text and reasoning when both present", () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { content: "Hello", reasoning: "I should greet" } }],
    });
    const { events } = processSSEBuffer("", `data: ${chunk}\n\n`);
    expect(events).toContainEqual({ type: "text", text: "Hello" });
    expect(events).toContainEqual({ type: "reasoning", text: "I should greet" });
  });

  test("does not emit reasoning when field is null", () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { content: "Hi", reasoning: null } }],
    });
    const { events } = processSSEBuffer("", `data: ${chunk}\n\n`);
    expect(events.filter((e) => e.type === "reasoning")).toHaveLength(0);
  });
});
