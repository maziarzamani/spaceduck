// Versioned WebSocket protocol types

import type { Message } from "./message";
import type { ToolCall, ToolResult } from "./tool";

/**
 * All WebSocket messages are typed with a version field.
 * This enables backward-compatible protocol evolution.
 */
export type WsClientEnvelope =
  | { v: 1; type: "message.send"; requestId: string; conversationId?: string; content: string }
  | { v: 1; type: "conversation.list" }
  | { v: 1; type: "conversation.history"; conversationId: string }
  | { v: 1; type: "conversation.create"; title?: string }
  | { v: 1; type: "conversation.delete"; conversationId: string };

export type WsServerEnvelope =
  | { v: 1; type: "message.accepted"; requestId: string; conversationId: string }
  | { v: 1; type: "processing.started"; requestId: string }
  | { v: 1; type: "stream.delta"; requestId: string; delta: string }
  | { v: 1; type: "stream.done"; requestId: string; messageId: string }
  | { v: 1; type: "stream.error"; requestId: string; code: string; message: string }
  | { v: 1; type: "tool.calling"; requestId: string; toolCall: ToolCall }
  | { v: 1; type: "tool.result"; requestId: string; toolResult: ToolResult }
  | { v: 1; type: "conversation.list"; conversations: ConversationSummary[] }
  | { v: 1; type: "conversation.history"; conversationId: string; messages: Message[] }
  | { v: 1; type: "conversation.created"; conversationId: string }
  | { v: 1; type: "conversation.deleted"; conversationId: string }
  | { v: 1; type: "error"; code: string; message: string };

export interface ConversationSummary {
  readonly id: string;
  readonly title?: string;
  readonly lastActiveAt: number;
}
