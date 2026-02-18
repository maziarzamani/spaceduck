// LLM provider interface with cancellation, error normalization, and tool support

import type { Message } from "./message";
import type { ToolDefinition } from "./tool";

export type ProviderErrorCode =
  | "throttled"
  | "auth_failed"
  | "invalid_request"
  | "context_length_exceeded"
  | "transient_network"
  | "cancelled"
  | "unknown";

export interface ProviderOptions {
  readonly signal?: AbortSignal;
  readonly tools?: ToolDefinition[];
  /** Constrain tool usage: "auto" (default), "none" (force text), or "required" (force tool call) */
  readonly toolChoice?: "auto" | "none" | "required";
}

/**
 * Chunks yielded by the provider during streaming.
 * - "text": a piece of the response text
 * - "tool_call": the LLM wants to call a tool
 */
export type ProviderChunk =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_call"; readonly toolCall: import("./tool").ToolCall };

export interface Provider {
  readonly name: string;
  chat(messages: Message[], options?: ProviderOptions): AsyncIterable<ProviderChunk>;
}
