// OpenAICompatibleProvider — shared base for all OpenAI-style Chat Completions
// providers (LM Studio, llamacpp, and eventually OpenRouter).
//
// Handles:
//   • Base URL normalization (with or without /v1, full endpoint URLs)
//   • Message conversion (with optional tool-less fallback mode)
//   • SSE streaming with tolerant chunk parsing
//   • ThinkStripper for local models that emit <think>…</think> blocks
//   • Tool call accumulation across streaming chunks
//   • Unified error classification

import type {
  Message,
  ProviderOptions,
  ProviderChunk,
  ToolDefinition,
} from "@spaceduck/core";
import { ProviderError, AbstractProvider } from "@spaceduck/core";
import type { WireMessage, WireToolDef } from "./wire";
import { processSSEBuffer } from "./sse";
import { ThinkStripper } from "./think-stripper";
import { classifyError, buildErrorHint } from "./errors";

// ── Config ───────────────────────────────────────────────────────────────────

export interface OpenAICompatibleConfig {
  /** Provider name used in error messages (e.g. "lmstudio", "llamacpp"). */
  readonly name: string;
  /** Model identifier. Pass null/undefined to omit from the request body. */
  readonly model?: string | null;
  /**
   * Base URL for the API. Accepts any of:
   *   http://127.0.0.1:8080
   *   http://127.0.0.1:8080/v1
   *   http://127.0.0.1:8080/v1/chat/completions   (trailing endpoint stripped)
   * All are normalized to http://127.0.0.1:8080/v1 internally.
   */
  readonly baseUrl: string;
  /** API key. If empty/undefined, the Authorization header is omitted. */
  readonly apiKey?: string;
  /** Strip <think>…</think> blocks from model output. Default: true. */
  readonly stripThinkTags?: boolean;
  /**
   * What to do when tool messages appear in the conversation but tools are
   * not being sent in this request (post-tool-execution round):
   *   "strip"  — convert to plain text so the model can still read them
   *   "error"  — pass through as-is (strict OpenAI behavior)
   * Default: "error"
   */
  readonly toolFallback?: "strip" | "error";
  /** Extra headers merged into every request (e.g. HTTP-Referer for OpenRouter). */
  readonly extraHeaders?: Record<string, string>;
  /** Extra body fields merged into every request (e.g. provider.require_parameters). */
  readonly extraBody?: Record<string, unknown>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  // Strip full endpoint path if user pasted the complete URL
  url = url.replace(/\/chat\/completions$/, "");
  if (!url.endsWith("/v1")) url += "/v1";
  return url;
}

function toWireMessages(
  messages: Message[],
  hasTools: boolean,
  toolFallback: "strip" | "error",
): WireMessage[] {
  const result: WireMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content });
    } else if (msg.role === "tool") {
      if (hasTools) {
        result.push({ role: "tool", tool_call_id: msg.toolCallId ?? "", content: msg.content });
      } else if (toolFallback === "strip") {
        // Inline tool results as user messages so the model can read them
        result.push({ role: "user", content: `[${msg.toolName ?? "tool"} result]:\n${msg.content}` });
      } else {
        result.push({ role: "tool", tool_call_id: msg.toolCallId ?? "", content: msg.content });
      }
    } else if (msg.role === "assistant" && msg.toolCalls?.length) {
      if (hasTools) {
        result.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        });
      } else if (toolFallback === "strip") {
        const names = msg.toolCalls.map((tc) => tc.name).join(", ");
        result.push({ role: "assistant", content: msg.content || `I called ${names} to look this up.` });
      } else {
        result.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        });
      }
    } else if (msg.role === "assistant") {
      result.push({ role: "assistant", content: msg.content });
    } else {
      result.push({ role: "user", content: msg.content });
    }
  }

  return result;
}

function toWireTools(tools: ToolDefinition[]): WireToolDef[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

// ── Provider ─────────────────────────────────────────────────────────────────

export class OpenAICompatibleProvider extends AbstractProvider {
  readonly name: string;
  protected readonly model: string | null;
  protected readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly stripThinkTags: boolean;
  private readonly toolFallback: "strip" | "error";
  private readonly extraHeaders: Record<string, string>;
  private readonly extraBody: Record<string, unknown>;

  constructor(config: OpenAICompatibleConfig) {
    super();
    this.name = config.name;
    this.model = config.model ?? null;
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey ?? "";
    this.stripThinkTags = config.stripThinkTags ?? true;
    this.toolFallback = config.toolFallback ?? "error";
    this.extraHeaders = config.extraHeaders ?? {};
    this.extraBody = config.extraBody ?? {};
  }

  protected async *_chat(messages: Message[], options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    const hasTools = !!(options?.tools && options.tools.length > 0);

    const body: Record<string, unknown> = {
      messages: toWireMessages(messages, hasTools, this.toolFallback),
      stream: true,
      ...this.extraBody,
    };

    if (this.model != null) {
      body.model = this.model;
    }

    if (hasTools) {
      body.tools = toWireTools(options!.tools!);
      if (options?.toolChoice) {
        body.tool_choice = options.toolChoice;
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.extraHeaders,
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const thinkStripper = this.stripThinkTags ? new ThinkStripper() : null;
    const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();
    let lastUsage: { promptTokens: number; completionTokens: number; totalTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } | undefined;

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`${this.name} API error: Status ${response.status}\nBody: ${errorBody}`);
      }

      if (!response.body) {
        throw new Error(`No response body received from ${this.name}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        if (options?.signal?.aborted) return;

        const { done, value } = await reader.read();
        if (done) break;

        const { events, remaining } = processSSEBuffer(buffer, decoder.decode(value, { stream: true }));
        buffer = remaining;

        for (const event of events) {
          if (event.type === "done") break;

          if (event.type === "text") {
            const raw = event.text;
            const visible = thinkStripper ? thinkStripper.feed(raw) : raw;
            if (visible) {
              const cleaned = visible.replace(/<\/?think>/g, "");
              if (cleaned) yield { type: "text", text: cleaned };
            }
          }

          if (event.type === "reasoning") {
            if (!thinkStripper) {
              yield { type: "text", text: event.text };
            }
            // When stripThinkTags is on, reasoning is silently discarded
          }

          if (event.type === "tool_delta") {
            const existing = toolCallAccumulator.get(event.index);
            if (existing) {
              if (event.arguments) existing.arguments += event.arguments;
            } else {
              toolCallAccumulator.set(event.index, {
                id: event.id ?? `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: event.name ?? "",
                arguments: event.arguments ?? "",
              });
            }
          }

          if (event.type === "usage") {
            lastUsage = event;
          }

          if (event.type === "finish") {
            if (
              (event.reason === "tool_calls" || event.reason === "stop") &&
              toolCallAccumulator.size > 0
            ) {
              yield* flushToolCalls(toolCallAccumulator);
            }
          }
        }
      }

      // Flush remaining think-stripper buffer
      if (thinkStripper) {
        const remaining = thinkStripper.flush();
        if (remaining) {
          const cleaned = remaining.replace(/<\/?think>/g, "").trim();
          if (cleaned) yield { type: "text", text: cleaned };
        }
      }

      // Emit any tool calls not yet flushed by a finish event
      if (toolCallAccumulator.size > 0) {
        yield* flushToolCalls(toolCallAccumulator);
      }

      if (lastUsage) {
        yield {
          type: "usage",
          usage: {
            inputTokens: lastUsage.promptTokens,
            outputTokens: lastUsage.completionTokens,
            totalTokens: lastUsage.totalTokens,
            ...(lastUsage.cacheReadTokens != null && { cacheReadTokens: lastUsage.cacheReadTokens }),
            ...(lastUsage.cacheWriteTokens != null && { cacheWriteTokens: lastUsage.cacheWriteTokens }),
          },
        };
      }
    } catch (err) {
      if (options?.signal?.aborted) return;

      const code = classifyError(err);
      const hint = buildErrorHint(code, this.name, this.baseUrl);
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`${this.name} error: ${message}${hint}`, code, err);
    }
  }
}

function* flushToolCalls(
  accumulator: Map<number, { id: string; name: string; arguments: string }>,
): Generator<ProviderChunk> {
  for (const [, tc] of accumulator) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.arguments || "{}");
    } catch {
      // pass — emit with empty args rather than dropping the tool call
    }
    yield { type: "tool_call", toolCall: { id: tc.id, name: tc.name, args } };
  }
  accumulator.clear();
}
