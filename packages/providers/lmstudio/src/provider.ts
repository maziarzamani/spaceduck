// LM Studio provider — connects to a local LM Studio instance via its
// OpenAI-compatible /v1/chat/completions endpoint.
//
// Differences from OpenRouter:
//   • No API key required (auth is optional)
//   • Runs on localhost — ECONNREFUSED means LM Studio isn't running
//   • Thinking models stream <think>…</think> tags; we strip them from
//     the text output and optionally expose them as reasoning chunks
//   • No OpenRouter-specific headers or `provider` body param needed

import type {
  Message,
  Provider,
  ProviderOptions,
  ProviderChunk,
  ProviderErrorCode,
  ToolDefinition,
} from "@spaceduck/core";
import { ProviderError } from "@spaceduck/core";

// ── Config ──────────────────────────────────────────────────────────────

export interface LMStudioProviderConfig {
  /** Model identifier as shown in LM Studio, e.g. "qwen/qwen3-4b-thinking-2507" */
  readonly model: string;
  /** Base URL including the /v1 prefix. Default: http://localhost:1234/v1 */
  readonly baseUrl?: string;
  /** Optional API key (LM Studio doesn't require one by default) */
  readonly apiKey?: string;
}

// ── Wire types (OpenAI-compatible, snake_case) ──────────────────────────

interface WireToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
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

// ── Helpers ─────────────────────────────────────────────────────────────

function toWireMessages(messages: Message[], hasTools: boolean): WireMessage[] {
  const result: WireMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content });
    } else if (msg.role === "tool") {
      if (hasTools) {
        // Standard OpenAI tool result format when tools are present
        result.push({ role: "tool", tool_call_id: msg.toolCallId ?? "", content: msg.content });
      } else {
        // When tools are omitted (post-tool-execution round), inline the
        // tool result as a user message so the model can read it naturally.
        result.push({ role: "user", content: `[${msg.toolName ?? "tool"} result]:\n${msg.content}` });
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
      } else {
        // When tools are omitted, convert assistant tool-call message to a
        // simple text message describing what happened.
        const names = msg.toolCalls.map((tc) => tc.name).join(", ");
        const text = msg.content || `I called ${names} to look this up.`;
        result.push({ role: "assistant", content: text });
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

function classifyError(err: unknown): ProviderErrorCode {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    const name = err.name.toLowerCase();
    if (msg.includes("econnrefused") || msg.includes("econnreset") || msg.includes("enotfound")) {
      return "transient_network";
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
    if (msg.includes("network") || msg.includes("fetch")) {
      return "transient_network";
    }
  }
  return "unknown";
}

// ── Think-tag stripping ─────────────────────────────────────────────────
// Qwen3 thinking models stream <think>…</think> blocks inline.
// We accumulate the thinking text and strip it so the user only sees the
// final answer.  A `reasoning` chunk type could be added later.

const enum ThinkState {
  Normal,
  InsideThink,
}

class ThinkStripper {
  private state = ThinkState.Normal;
  private buf = "";

  /** Feed a raw text chunk. Returns the visible (non-think) text to emit. */
  feed(text: string): string {
    let out = "";
    this.buf += text;

    while (this.buf.length > 0) {
      if (this.state === ThinkState.Normal) {
        const openIdx = this.buf.indexOf("<think>");
        if (openIdx === -1) {
          // No opening tag in buffer — but buffer might end with a partial "<think"
          // Keep trailing chars that could be start of <think> tag
          const safeEnd = this.findSafeFlush(this.buf, "<think>");
          out += this.buf.slice(0, safeEnd);
          this.buf = this.buf.slice(safeEnd);
          break;
        }
        out += this.buf.slice(0, openIdx);
        this.buf = this.buf.slice(openIdx + 7); // skip "<think>"
        this.state = ThinkState.InsideThink;
      } else {
        const closeIdx = this.buf.indexOf("</think>");
        if (closeIdx === -1) {
          // Still inside think block — keep buffering, discard nothing yet
          // But keep at most what we need to detect </think>
          if (this.buf.length > 8) {
            // Discard everything except last 7 chars (could be partial "</think")
            this.buf = this.buf.slice(-7);
          }
          break;
        }
        this.buf = this.buf.slice(closeIdx + 8); // skip "</think>"
        this.state = ThinkState.Normal;
      }
    }

    return out;
  }

  /** Flush any remaining buffer (end of stream). */
  flush(): string {
    if (this.state === ThinkState.Normal) {
      const rest = this.buf;
      this.buf = "";
      return rest;
    }
    // Still inside a think block — discard the thinking text
    this.buf = "";
    return "";
  }

  private findSafeFlush(buf: string, tag: string): number {
    // Keep the last N chars if they could be the start of `tag`
    for (let overlap = Math.min(tag.length - 1, buf.length); overlap > 0; overlap--) {
      if (tag.startsWith(buf.slice(-overlap))) {
        return buf.length - overlap;
      }
    }
    return buf.length;
  }
}

// ── Provider ────────────────────────────────────────────────────────────

export class LMStudioProvider implements Provider {
  readonly name = "lmstudio";
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: LMStudioProviderConfig) {
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? "http://localhost:1234/v1").replace(/\/+$/, "");
    this.apiKey = config.apiKey ?? "lm-studio";
  }

  async *chat(messages: Message[], options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    const hasTools = !!(options?.tools && options.tools.length > 0);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: toWireMessages(messages, hasTools),
      stream: true,
    };

    if (hasTools) {
      body.tools = toWireTools(options!.tools!);
      if (options?.toolChoice) {
        body.tool_choice = options.toolChoice;
      }
    }

    const thinkStripper = new ThinkStripper();

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`LM Studio API error: Status ${response.status}\nBody: ${errorBody}`);
      }

      if (!response.body) {
        throw new Error("No response body received from LM Studio");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const toolCallAccumulator = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();

      while (true) {
        if (options?.signal?.aborted) return;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

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

          // Handle text content — strip <think> blocks from thinking models
          if (delta.content) {
            const visible = thinkStripper.feed(delta.content);
            if (visible) {
              // Final safety: remove any residual think tags that slipped through
              const cleaned = visible.replace(/<\/?think>/g, "");
              if (cleaned) {
                yield { type: "text", text: cleaned };
              }
            }
          }

          // Handle streaming tool calls
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

          // Emit accumulated tool calls on finish
          if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
            if (toolCallAccumulator.size > 0) {
              for (const [, tc] of toolCallAccumulator) {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(tc.arguments || "{}");
                } catch {
                  // If parsing fails, pass empty args
                }
                yield { type: "tool_call", toolCall: { id: tc.id, name: tc.name, args } };
              }
              toolCallAccumulator.clear();
            }
          }
        }
      }

      // Flush any remaining visible text
      const remaining = thinkStripper.flush();
      if (remaining) {
        const cleaned = remaining.replace(/<\/?think>/g, "").trim();
        if (cleaned) {
          yield { type: "text", text: cleaned };
        }
      }

      // Emit any remaining tool calls
      if (toolCallAccumulator.size > 0) {
        for (const [, tc] of toolCallAccumulator) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.arguments || "{}");
          } catch {
            // pass
          }
          yield { type: "tool_call", toolCall: { id: tc.id, name: tc.name, args } };
        }
      }
    } catch (err) {
      if (options?.signal?.aborted) return;

      const code = classifyError(err);
      const message = err instanceof Error ? err.message : String(err);

      // Add a helpful hint when LM Studio isn't reachable
      const hint = code === "transient_network"
        ? " — is LM Studio running on " + this.baseUrl + "?"
        : "";

      throw new ProviderError(`LM Studio error: ${message}${hint}`, code, err);
    }
  }
}
