// Wire types for the OpenAI-compatible Chat Completions API (snake_case).
// Shared across all OpenAI-compatible providers (LM Studio, llamacpp, etc.).

export interface WireToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type WireMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface WireDelta {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

// Some "compatible" servers emit message instead of delta inside SSE chunks
export interface WireChoice {
  delta?: WireDelta;
  message?: { content?: string | null };
  finish_reason?: string | null;
}

export interface WireChunk {
  choices?: WireChoice[];
  // Extra fields (timings, usage, system_fingerprint, etc.) are intentionally
  // not typed here — they are ignored by the parser.
}
