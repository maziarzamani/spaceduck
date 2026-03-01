// Gemini provider adapter using @google/genai SDK
// Maps spaceduck Provider interface to Google AI Studio (Gemini) API
// Supports streaming text and function calling (tool use)

import { GoogleGenAI } from "@google/genai";
import type { Content, FunctionDeclaration } from "@google/genai";
import type { Message, ProviderOptions, ProviderChunk, ProviderErrorCode, ToolDefinition } from "@spaceduck/core";
import { ProviderError, AbstractProvider } from "@spaceduck/core";

export interface GeminiProviderConfig {
  readonly apiKey: string;
  readonly model?: string;
}

/**
 * Convert spaceduck ToolDefinition[] to Gemini FunctionDeclaration[] format.
 */
function toGeminiFunctionDeclarations(tools: ToolDefinition[]): FunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.parameters,
  }));
}

/**
 * Maps spaceduck Message[] to Gemini Content[] format.
 * Role mapping:
 *   system  -> extracted as systemInstruction
 *   user    -> "user"
 *   assistant -> "model" (with optional functionCall parts)
 *   tool    -> "user" (with functionResponse parts)
 */
function toGeminiContents(messages: Message[]): {
  contents: Content[];
  systemInstruction?: string;
} {
  let systemInstruction: string | undefined;
  const contents: Content[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = systemInstruction
        ? `${systemInstruction}\n\n${msg.content}`
        : msg.content;
      continue;
    }

    if (msg.role === "tool") {
      // Tool results are sent back as user role with functionResponse parts
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: (msg as any).toolName ?? "unknown",
              id: msg.toolCallId,
              response: { content: msg.content },
            },
          } as any,
        ],
      });
      continue;
    }

    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant message that requested tool calls
      const parts: any[] = [];
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        parts.push({
          functionCall: {
            name: tc.name,
            id: tc.id,
            args: tc.args,
          },
        });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    // Regular user or assistant text message
    const role = msg.role === "assistant" ? "model" : "user";
    contents.push({
      role,
      parts: [{ text: msg.content }],
    });
  }

  return { contents, systemInstruction };
}

/**
 * Map Gemini API errors to normalized ProviderErrorCode.
 */
function classifyError(err: unknown): ProviderErrorCode {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    const name = err.name.toLowerCase();

    if (msg.includes("api key") || msg.includes("unauthorized") || msg.includes("permission")) {
      return "auth_failed";
    }
    if (msg.includes("rate limit") || msg.includes("quota") || msg.includes("resource exhausted")) {
      return "throttled";
    }
    if (msg.includes("context length") || msg.includes("token limit") || msg.includes("too long")) {
      return "context_length_exceeded";
    }
    if (msg.includes("invalid") || msg.includes("bad request")) {
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

export class GeminiProvider extends AbstractProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(config: GeminiProviderConfig) {
    super();
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model ?? "gemini-2.5-flash";
  }

  protected async *_chat(messages: Message[], options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    const { contents, systemInstruction } = toGeminiContents(messages);

    // Build config with optional tools
    const config: Record<string, unknown> = {};
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    // Add tool definitions if provided
    const tools = options?.tools;
    if (tools && tools.length > 0) {
      config.tools = [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }];
    }

    try {
      const response = await this.client.models.generateContentStream({
        model: this.model,
        contents,
        config: Object.keys(config).length > 0 ? config : undefined,
      });

      let lastUsage: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; cachedContentTokenCount?: number } | undefined;

      for await (const chunk of response) {
        if (options?.signal?.aborted) {
          return;
        }

        const meta = (chunk as any).usageMetadata;
        if (meta) {
          lastUsage = meta;
        }

        // Check for function calls in this chunk
        const functionCalls = (chunk as any).functionCalls;
        if (functionCalls && Array.isArray(functionCalls)) {
          for (const fc of functionCalls) {
            yield {
              type: "tool_call",
              toolCall: {
                id: fc.id ?? `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: fc.name ?? "unknown",
                args: fc.args ?? {},
              },
            };
          }
        }

        // Check for text in this chunk
        const text = chunk.text;
        if (text) {
          yield { type: "text", text };
        }
      }

      if (lastUsage && lastUsage.promptTokenCount !== undefined) {
        const input = lastUsage.promptTokenCount;
        const output = lastUsage.candidatesTokenCount ?? 0;
        yield {
          type: "usage",
          usage: {
            inputTokens: input,
            outputTokens: output,
            totalTokens: lastUsage.totalTokenCount ?? (input + output),
            ...(lastUsage.cachedContentTokenCount != null && { cacheReadTokens: lastUsage.cachedContentTokenCount }),
          },
        };
      }
    } catch (err) {
      if (options?.signal?.aborted) {
        return;
      }

      const code = classifyError(err);
      throw new ProviderError(
        `Gemini API error: ${err instanceof Error ? err.message : String(err)}`,
        code,
        err,
      );
    }
  }
}
