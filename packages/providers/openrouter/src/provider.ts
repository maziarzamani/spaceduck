// OpenRouter provider — direct fetch to Chat Completions API
// Uses raw fetch() with proper snake_case JSON format for reliable tool calling.
// See: https://openrouter.ai/docs/guides/features/tool-calling

import type {
  Message,
  Provider,
  ProviderOptions,
  ProviderChunk,
  ProviderErrorCode,
  ToolDefinition,
} from "@spaceduck/core";
import { ProviderError } from "@spaceduck/core";

export interface OpenRouterProviderConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly appName?: string;
  readonly appUrl?: string;
}

// ── Wire types (snake_case, matches OpenRouter/OpenAI API exactly) ──────

interface WireToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface WireToolCallFunction {
  name: string;
  arguments: string;
}

interface WireToolCall {
  id: string;
  type: "function";
  function: WireToolCallFunction;
}

type WireMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface WireDelta {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface WireChoice {
  delta?: WireDelta;
  finish_reason?: string | null;
}

interface WireChunk {
  choices?: WireChoice[];
}

// ── Conversion helpers ──────────────────────────────────────────────────

function toWireMessages(messages: Message[]): WireMessage[] {
  const result: WireMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content });
      continue;
    }

    if (msg.role === "tool") {
      result.push({
        role: "tool",
        tool_call_id: msg.toolCallId ?? "",
        content: msg.content,
      });
      continue;
    }

    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      result.push({
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        })),
      });
      continue;
    }

    if (msg.role === "assistant") {
      result.push({ role: "assistant", content: msg.content });
      continue;
    }

    // user
    result.push({ role: "user", content: msg.content });
  }

  return result;
}

function toWireTools(tools: ToolDefinition[]): WireToolDef[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Map OpenRouter API errors to normalized ProviderErrorCode.
 */
function classifyError(err: unknown): ProviderErrorCode {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    const name = err.name.toLowerCase();

    if (msg.includes("api key") || msg.includes("unauthorized") || msg.includes("401")) {
      return "auth_failed";
    }
    if (msg.includes("rate limit") || msg.includes("429") || msg.includes("quota")) {
      return "throttled";
    }
    if (msg.includes("context length") || msg.includes("token") || msg.includes("too long")) {
      return "context_length_exceeded";
    }
    if (msg.includes("invalid") || msg.includes("400") || msg.includes("bad request")) {
      return "invalid_request";
    }
    if (name === "aborterror" || msg.includes("aborted") || msg.includes("cancelled")) {
      return "cancelled";
    }
    if (msg.includes("network") || msg.includes("fetch") || msg.includes("econnrefused")) {
      return "transient_network";
    }
  }
  return "unknown";
}

// ── Provider ────────────────────────────────────────────────────────────

export class OpenRouterProvider implements Provider {
  readonly name = "openrouter";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = "https://openrouter.ai/api/v1";

  constructor(config: OpenRouterProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "nvidia/nemotron-3-nano-30b-a3b:free";
  }

  async *chat(messages: Message[], options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    const wireMessages = toWireMessages(messages);

    // Build request body
    const body: Record<string, unknown> = {
      model: this.model,
      messages: wireMessages,
      stream: true,
      provider: {
        require_parameters: true,
      },
    };

    // Add tools if provided
    const tools = options?.tools;
    if (tools && tools.length > 0) {
      body.tools = toWireTools(tools);
      if (options?.toolChoice) {
        body.tool_choice = options.toolChoice;
      }
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://spaceduck.ai",
          "X-Title": "spaceduck",
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `API error occurred: Status ${response.status}\nBody: ${errorBody}`,
        );
      }

      if (!response.body) {
        throw new Error("No response body received");
      }

      // Parse SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Accumulate streaming tool calls by index
      const toolCallAccumulator = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();

      while (true) {
        if (options?.signal?.aborted) return;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          let chunk: WireChunk;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }

          const choice = chunk.choices?.[0];
          if (!choice?.delta) continue;

          const delta = choice.delta;

          // Handle text content
          if (delta.content) {
            yield { type: "text", text: delta.content };
          }

          // Handle streaming tool calls (accumulated across chunks)
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCallAccumulator.get(tc.index);
              if (existing) {
                if (tc.function?.arguments) {
                  existing.arguments += tc.function.arguments;
                }
              } else {
                toolCallAccumulator.set(tc.index, {
                  id: tc.id ?? `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  name: tc.function?.name ?? "",
                  arguments: tc.function?.arguments ?? "",
                });
              }
            }
          }

          // When finish_reason is "tool_calls" or "stop", emit accumulated tool calls
          if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
            if (toolCallAccumulator.size > 0) {
              for (const [, tc] of toolCallAccumulator) {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(tc.arguments || "{}");
                } catch {
                  // If parsing fails, pass empty args
                }

                yield {
                  type: "tool_call",
                  toolCall: { id: tc.id, name: tc.name, args },
                };
              }
              toolCallAccumulator.clear();
            }
          }
        }
      }

      // Emit any remaining tool calls that weren't flushed
      if (toolCallAccumulator.size > 0) {
        for (const [, tc] of toolCallAccumulator) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.arguments || "{}");
          } catch {
            // If parsing fails, pass empty args
          }

          yield {
            type: "tool_call",
            toolCall: { id: tc.id, name: tc.name, args },
          };
        }
      }
    } catch (err) {
      if (options?.signal?.aborted) return;

      const code = classifyError(err);
      throw new ProviderError(
        `OpenRouter API error: ${err instanceof Error ? err.message : String(err)}`,
        code,
        err,
      );
    }
  }
}
