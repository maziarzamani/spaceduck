// Message types and conversation structure

import type { ToolCall, ToolResult } from "./tool";

export type ResponseStatus =
  | "streaming"
  | "completed"
  | "failed_partial"
  | "failed_empty";

export interface Message {
  readonly id: string;
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly content: string;
  readonly timestamp: number;
  readonly status?: ResponseStatus;
  readonly traceId?: string;
  readonly source?: "user" | "assistant" | "system" | "fact-extractor" | "compaction" | "tool";
  readonly requestId?: string;
  /** Tool calls requested by the assistant (present when role === "assistant") */
  readonly toolCalls?: ToolCall[];
  /** Links a tool result message back to its call (present when role === "tool") */
  readonly toolCallId?: string;
  /** The tool name (present when role === "tool") */
  readonly toolName?: string;
}

export interface Conversation {
  readonly id: string;
  readonly title?: string;
  readonly createdAt: number;
  readonly lastActiveAt: number;
  readonly messages: Message[];
}
