// Tolerant SSE line parser for OpenAI-compatible streaming responses.
//
// Design goals:
//   • Never crash on a chunk — skip malformed lines instead of throwing
//   • Accept text from delta.content OR message.content (both are observed in
//     "compatible" servers)
//   • Ignore unknown top-level fields (timings, usage, system_fingerprint, etc.)
//   • Stop cleanly on [DONE]

import type { WireChunk } from "./wire";

export type SSEEvent =
  | { type: "text"; text: string }
  | { type: "tool_delta"; index: number; id?: string; name?: string; arguments?: string }
  | { type: "finish"; reason: string | null }
  | { type: "done" };

/**
 * Parse a single SSE line into an event, or return null to skip it.
 * The line should already have the "data: " prefix stripped.
 */
function parseChunk(data: string): WireChunk | null {
  try {
    return JSON.parse(data) as WireChunk;
  } catch {
    return null;
  }
}

/**
 * Process a buffer of raw SSE bytes into discrete events.
 * Returns an array of events and the leftover (incomplete) buffer tail.
 */
export function processSSEBuffer(
  buffer: string,
  incoming: string,
): { events: SSEEvent[]; remaining: string } {
  const combined = buffer + incoming;
  const lines = combined.split("\n");
  const remaining = lines.pop() ?? "";
  const events: SSEEvent[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data: ")) continue;

    const data = trimmed.slice(6);
    if (data === "[DONE]") {
      events.push({ type: "done" });
      continue;
    }

    const chunk = parseChunk(data);
    if (!chunk) continue;

    const choice = chunk.choices?.[0];
    if (!choice) continue;

    // Text content: prefer delta.content, fall back to message.content
    const text = choice.delta?.content ?? choice.message?.content ?? null;
    if (text) {
      events.push({ type: "text", text });
    }

    // Streaming tool call deltas
    if (choice.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        events.push({
          type: "tool_delta",
          index: tc.index,
          id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments,
        });
      }
    }

    // finish_reason
    if (choice.finish_reason != null) {
      events.push({ type: "finish", reason: choice.finish_reason });
    }
  }

  return { events, remaining };
}
