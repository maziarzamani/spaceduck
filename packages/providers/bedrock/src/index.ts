// @spaceduck/provider-bedrock — Amazon Bedrock chat + embedding adapters
//
// Chat: Native Bedrock Converse API (required for Nova, Claude, and all models)
//   POST /model/{modelId}/converse
//   - System prompt is a top-level "system" field (NOT a message role)
//   - Content is an array of { text } objects
//   - Tool results use { toolResult: { toolUseId, content } } format
//
// Embeddings: Titan Text Embeddings V2 + Nova 2 Multimodal Embeddings
//   POST /model/{modelId}/invoke
//   Model auto-detected: "nova" in ID → Nova API, otherwise → Titan API
//
// Authentication: Amazon Bedrock API key (Bearer token)
//   Generate at: AWS Console → Amazon Bedrock → API keys
//   Set env var:  AWS_BEARER_TOKEN_BEDROCK=<your-key>
//
// Supported models:
//   global.amazon.nova-2-lite-v1:0        (fast, cheap, reasoning)
//   us.anthropic.claude-3-5-haiku-20241022-v1:0  (Claude Haiku)
//   amazon.nova-pro-v1:0                  (Nova Pro)

import type {
  Message,
  ProviderOptions,
  ProviderChunk,
  ProviderErrorCode,
  ToolDefinition,
  EmbeddingProvider,
  EmbedOptions,
} from "@spaceduck/core";
import { ProviderError, AbstractProvider } from "@spaceduck/core";

// ── Converse API wire types ───────────────────────────────────────────────────

type ConverseContentPart =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }
  | { toolResult: { toolUseId: string; content: Array<{ text: string }> } };

interface ConverseMessage {
  role: "user" | "assistant";
  content: ConverseContentPart[];
}

interface ConverseToolSpec {
  toolSpec: {
    name: string;
    description: string;
    inputSchema: { json: Record<string, unknown> };
  };
}

interface ConverseRequest {
  messages: ConverseMessage[];
  system?: Array<{ text: string }>;
  toolConfig?: { tools: ConverseToolSpec[] };
  inferenceConfig?: { maxTokens?: number };
}

interface ConverseResponse {
  output: {
    message: {
      role: string;
      content: ConverseContentPart[];
    };
  };
  stopReason: "end_turn" | "tool_use" | "max_tokens" | string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
  };
}

// ── Message conversion ────────────────────────────────────────────────────────

function toConverseRequest(
  messages: Message[],
  tools: ToolDefinition[],
): ConverseRequest {
  const systemParts: string[] = [];
  const converseMessages: ConverseMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
      continue;
    }

    if (msg.role === "tool") {
      // Tool results go as user messages with toolResult content
      converseMessages.push({
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: msg.toolCallId ?? "unknown",
              content: [{ text: msg.content }],
            },
          },
        ],
      });
      continue;
    }

    if (msg.role === "assistant" && msg.toolCalls?.length) {
      const parts: ConverseContentPart[] = [];
      if (msg.content) parts.push({ text: msg.content });
      for (const tc of msg.toolCalls) {
        parts.push({
          toolUse: {
            toolUseId: tc.id,
            name: tc.name,
            input: tc.args as Record<string, unknown>,
          },
        });
      }
      converseMessages.push({ role: "assistant", content: parts });
      continue;
    }

    const role = msg.role === "assistant" ? "assistant" : "user";
    converseMessages.push({
      role,
      content: [{ text: msg.content || " " }],
    });
  }

  // Bedrock requires alternating user/assistant turns — merge consecutive same-role messages
  const merged = mergeConsecutive(converseMessages);

  const req: ConverseRequest = {
    messages: merged,
    inferenceConfig: { maxTokens: 4096 },
  };

  if (systemParts.length > 0) {
    req.system = systemParts.map((t) => ({ text: t }));
  }

  // Bedrock requires toolConfig whenever any message contains toolUse or toolResult blocks.
  // The AgentLoop omits tools on round > 0 to prevent infinite loops, so we reconstruct
  // minimal tool specs from toolUse entries already present in the conversation history.
  if (tools.length > 0) {
    req.toolConfig = {
      tools: tools.map((t) => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.parameters },
        },
      })),
    };
  } else {
    const usedToolNames = new Set<string>();
    for (const msg of merged) {
      for (const part of msg.content) {
        if ("toolUse" in part) usedToolNames.add(part.toolUse.name);
      }
    }
    if (usedToolNames.size > 0) {
      req.toolConfig = {
        tools: Array.from(usedToolNames).map((name) => ({
          toolSpec: {
            name,
            description: name,
            inputSchema: { json: { type: "object", properties: {} } },
          },
        })),
      };
    }
  }

  return req;
}

function mergeConsecutive(messages: ConverseMessage[]): ConverseMessage[] {
  const result: ConverseMessage[] = [];
  for (const msg of messages) {
    const last = result[result.length - 1];
    if (last && last.role === msg.role) {
      last.content = [...last.content, ...msg.content];
    } else {
      result.push({ role: msg.role, content: [...msg.content] });
    }
  }

  // Bedrock requires the conversation to end with a user message.
  // Strip any trailing assistant messages to avoid "does not support
  // assistant message prefill" errors.
  while (result.length > 0 && result[result.length - 1].role === "assistant") {
    result.pop();
  }

  return result;
}

// ── Error classification ──────────────────────────────────────────────────────

function classifyError(err: unknown): ProviderErrorCode {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    const name = err.name.toLowerCase();
    if (
      msg.includes("credentials") ||
      msg.includes("unauthorized") ||
      msg.includes("access denied") ||
      msg.includes("invalid api key") ||
      msg.includes("bearer")
    ) return "auth_failed";
    if (msg.includes("throttl") || msg.includes("rate limit") || msg.includes("too many"))
      return "throttled";
    if (msg.includes("context length") || msg.includes("token limit") || msg.includes("too long"))
      return "context_length_exceeded";
    if (msg.includes("400") || msg.includes("bad request") || msg.includes("invalid"))
      return "invalid_request";
    if (name === "aborterror" || msg.includes("aborted") || msg.includes("cancelled"))
      return "cancelled";
    if (msg.includes("econnrefused") || msg.includes("econnreset") || msg.includes("network") || msg.includes("fetch"))
      return "transient_network";
  }
  return "unknown";
}

// ── Provider ──────────────────────────────────────────────────────────────────

export interface BedrockProviderConfig {
  readonly model?: string;
  /** Amazon Bedrock API key. Falls back to AWS_BEARER_TOKEN_BEDROCK or BEDROCK_API_KEY env vars. */
  readonly apiKey?: string;
  /** AWS region. Falls back to AWS_REGION env var. Default: us-east-1 */
  readonly region?: string;
}

export class BedrockProvider extends AbstractProvider {
  readonly name = "bedrock";
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: BedrockProviderConfig = {}) {
    super();
    this.model = config.model ?? "global.amazon.nova-2-lite-v1:0";

    const region = config.region ?? process.env.AWS_REGION ?? "us-east-1";
    this.baseUrl = `https://bedrock-runtime.${region}.amazonaws.com`;

    this.apiKey =
      config.apiKey ??
      process.env.AWS_BEARER_TOKEN_BEDROCK ??
      process.env.BEDROCK_API_KEY ??
      "";
  }

  protected async *_chat(messages: Message[], options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    const tools = options?.tools ?? [];
    const body = toConverseRequest(messages, tools);

    const url = `${this.baseUrl}/model/${encodeURIComponent(this.model)}/converse`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });
    } catch (err) {
      if (options?.signal?.aborted) return;
      throw new ProviderError(
        `Bedrock connection failed: ${err instanceof Error ? err.message : String(err)}`,
        "transient_network",
        err,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "(no body)");
      const code = classifyError(new Error(errorBody));
      throw new ProviderError(
        `Bedrock API error: Status ${response.status}\nBody: ${errorBody}`,
        code,
      );
    }

    let data: ConverseResponse;
    try {
      data = await response.json() as ConverseResponse;
    } catch (err) {
      throw new ProviderError("Bedrock returned non-JSON response", "invalid_request", err);
    }

    if (options?.signal?.aborted) return;

    const content = data.output?.message?.content ?? [];

    // Yield text chunks
    for (const part of content) {
      if ("text" in part && part.text) {
        yield { type: "text", text: part.text };
      }
    }

    // Yield tool calls
    for (const part of content) {
      if ("toolUse" in part) {
        yield {
          type: "tool_call",
          toolCall: {
            id: part.toolUse.toolUseId,
            name: part.toolUse.name,
            args: part.toolUse.input,
          },
        };
      }
    }

    if (data.usage) {
      yield {
        type: "usage",
        usage: {
          inputTokens: data.usage.inputTokens,
          outputTokens: data.usage.outputTokens,
          totalTokens: data.usage.totalTokens,
          ...(data.usage.cacheReadInputTokens != null && { cacheReadTokens: data.usage.cacheReadInputTokens }),
          ...(data.usage.cacheWriteInputTokens != null && { cacheWriteTokens: data.usage.cacheWriteInputTokens }),
        },
      };
    }
  }
}

// ── Bedrock Embedding Provider ────────────────────────────────────────────────
// Supports both Titan Text Embeddings V2 and Nova 2 Multimodal Embeddings.
// Model auto-detected by ID: contains "nova" → Nova API, otherwise → Titan API.

/** Internal Nova purpose enum — maps from our clean API to Bedrock wire values. */
const PURPOSE_MAP = {
  index: "GENERIC_INDEX",
  retrieval: "TEXT_RETRIEVAL",
} as const;

export interface BedrockEmbeddingConfig {
  /**
   * Embedding model ID.
   * Default: amazon.titan-embed-text-v2:0
   * Nova 2: amazon.nova-2-multimodal-embeddings-v1:0
   */
  readonly model?: string;
  /** Output vector size. Titan: 256|512|1024. Nova: 256|384|1024|3072. Default: 1024 */
  readonly dimensions?: number;
  /** Amazon Bedrock API key. Falls back to AWS_BEARER_TOKEN_BEDROCK or BEDROCK_API_KEY env vars. */
  readonly apiKey?: string;
  /** AWS region. Falls back to AWS_REGION env var. Default: us-east-1 */
  readonly region?: string;
}

/**
 * Amazon Bedrock embedding provider (Titan V2 + Nova 2 Multimodal).
 *
 * Uses the InvokeModel REST API with Bearer token auth.
 * Endpoint: https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/invoke
 */
export class BedrockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "bedrock";
  readonly model: string;
  readonly dimensions: number;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly isNova: boolean;

  constructor(config: BedrockEmbeddingConfig = {}) {
    this.dimensions = config.dimensions ?? 1024;
    this.model = config.model ?? "amazon.titan-embed-text-v2:0";
    this.isNova = this.model.includes("nova");

    const region = config.region ?? process.env.AWS_REGION ?? "us-east-1";
    this.baseUrl = `https://bedrock-runtime.${region}.amazonaws.com`;

    this.apiKey =
      config.apiKey ??
      process.env.AWS_BEARER_TOKEN_BEDROCK ??
      process.env.BEDROCK_API_KEY ??
      "";
  }

  async embed(text: string, options?: EmbedOptions): Promise<Float32Array> {
    const url = `${this.baseUrl}/model/${encodeURIComponent(this.model)}/invoke`;
    const body = this.isNova
      ? this.buildNovaBody(text, options)
      : this.buildTitanBody(text);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new ProviderError(
        `Failed to connect to Bedrock embedding API: ${cause}`,
        "transient_network",
        cause,
      );
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => "(no body)");
      const code: ProviderErrorCode =
        response.status === 401 || response.status === 403 ? "auth_failed" :
        response.status === 429 ? "throttled" : "invalid_request";
      throw new ProviderError(
        `Bedrock embedding API error ${response.status}: ${errBody}`,
        code,
      );
    }

    const json = await response.json();
    return this.isNova ? this.parseNovaResponse(json) : this.parseTitanResponse(json);
  }

  async embedBatch(texts: string[], options?: EmbedOptions): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const CONCURRENCY = 8;
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += CONCURRENCY) {
      const batch = texts.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map((t) => this.embed(t, options)));
      results.push(...batchResults);
    }
    return results;
  }

  // ── Nova 2 Multimodal Embeddings ────────────────────────────────────

  private buildNovaBody(text: string, options?: EmbedOptions): Record<string, unknown> {
    const purpose = options?.purpose ?? "index";
    return {
      schemaVersion: "nova-multimodal-embed-v1",
      taskType: "SINGLE_EMBEDDING",
      singleEmbeddingParams: {
        embeddingPurpose: PURPOSE_MAP[purpose],
        embeddingDimension: this.dimensions,
        text: {
          truncationMode: "END",
          value: text,
        },
      },
    };
  }

  private parseNovaResponse(json: unknown): Float32Array {
    const body = json as {
      embeddings?: Array<{
        embedding?: number[];
        truncatedCharLength?: number;
      }>;
    };

    const entry = body?.embeddings?.[0];
    if (!entry?.embedding || !Array.isArray(entry.embedding)) {
      const preview = JSON.stringify(json).slice(0, 200);
      throw new ProviderError(
        `Nova embedding response missing embeddings[0].embedding. Body: ${preview}`,
        "invalid_request",
      );
    }

    if (entry.truncatedCharLength !== undefined) {
      // Truncation occurred — callers should know
      console.warn(
        `[bedrock-embed] Input truncated at ${entry.truncatedCharLength} chars (model: ${this.model})`,
      );
    }

    if (entry.embedding.length !== this.dimensions) {
      throw new ProviderError(
        `Nova embedding dimension mismatch: expected ${this.dimensions}, got ${entry.embedding.length}`,
        "invalid_request",
      );
    }

    return new Float32Array(entry.embedding);
  }

  // ── Titan Text Embeddings V2 ────────────────────────────────────────

  private buildTitanBody(text: string): Record<string, unknown> {
    return {
      inputText: text,
      dimensions: this.dimensions,
      normalize: true,
    };
  }

  private parseTitanResponse(json: unknown): Float32Array {
    const body = json as { embedding?: number[] };

    if (!body?.embedding || !Array.isArray(body.embedding)) {
      throw new ProviderError(
        "Bedrock Titan embedding response missing 'embedding' array",
        "invalid_request",
      );
    }

    if (body.embedding.length !== this.dimensions) {
      throw new ProviderError(
        `Titan embedding dimension mismatch: expected ${this.dimensions}, got ${body.embedding.length}`,
        "invalid_request",
      );
    }

    return new Float32Array(body.embedding);
  }
}
