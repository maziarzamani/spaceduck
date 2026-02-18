// Tool system types -- definitions, calls, results

/**
 * JSON Schema describing a tool the LLM can call.
 * Sent to the provider as part of the request.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>; // JSON Schema object
}

/**
 * A tool invocation requested by the LLM.
 * The provider returns these when it wants to call a tool.
 */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/**
 * The result of executing a tool call.
 * Fed back to the provider so it can continue reasoning.
 */
export interface ToolResult {
  readonly toolCallId: string;
  readonly name: string;
  readonly content: string;
  readonly isError?: boolean;
}
