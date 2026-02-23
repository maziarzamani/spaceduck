// LM Studio embedding provider — connects to a local LM Studio instance
// via its OpenAI-compatible /v1/embeddings endpoint.
//
// Supports instruction-aware models like Qwen3-Embedding that benefit
// from task-specific prefixes for improved retrieval quality.

import type { EmbeddingProvider } from "@spaceduck/core";
import { ProviderError } from "@spaceduck/core";

export interface LMStudioEmbeddingConfig {
  /** Model identifier as shown in LM Studio, e.g. "Qwen3-Embedding-0.6B" */
  readonly model: string;
  /** Base URL including the /v1 prefix. Default: http://localhost:1234/v1 */
  readonly baseUrl?: string;
  /** Optional API key */
  readonly apiKey?: string;
  /** Output embedding dimensions. Qwen3 supports 32-1024, default 1024. */
  readonly dimensions?: number;
  /** Task instruction prepended to input for instruction-aware models. */
  readonly instruction?: string;
  /** Override the provider name (e.g. "llamacpp" when reusing this class). */
  readonly name?: string;
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { prompt_tokens: number; total_tokens: number };
}

export class LMStudioEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;

  private readonly displayName: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly instruction: string | undefined;

  constructor(config: LMStudioEmbeddingConfig) {
    this.name = config.name ?? "lmstudio";
    this.displayName = this.name === "llamacpp" ? "llama.cpp" : "LM Studio";
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? "http://localhost:1234/v1").replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.dimensions = config.dimensions ?? 1024;
    this.instruction = config.instruction;
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.callEmbeddingAPI([this.prepareInput(text)]);
    return this.validateAndConvert(results[0]);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const inputs = texts.map((t) => this.prepareInput(t));
    const results = await this.callEmbeddingAPI(inputs);

    // Sort by index to ensure correct ordering
    results.sort((a, b) => a.index - b.index);

    return results.map((r) => this.validateAndConvert(r));
  }

  private prepareInput(text: string): string {
    if (this.instruction) {
      return `${this.instruction}${text}`;
    }
    return text;
  }

  private validateAndConvert(item: { embedding: number[]; index: number }): Float32Array {
    if (item.embedding.length !== this.dimensions) {
      throw new ProviderError(
        `Embedding dimension mismatch: expected ${this.dimensions}, got ${item.embedding.length} from model "${this.model}"`,
        "invalid_request",
      );
    }
    return new Float32Array(item.embedding);
  }

  private async callEmbeddingAPI(
    input: string[],
  ): Promise<Array<{ embedding: number[]; index: number }>> {
    const url = `${this.baseUrl}/embeddings`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const body: Record<string, unknown> = {
      model: this.model,
      input,
    };

    // Include dimensions hint for models that support it (Qwen3, nomic, etc.)
    if (this.dimensions) {
      body.dimensions = this.dimensions;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (cause) {
      const msg =
        cause instanceof TypeError && String(cause).includes("ECONNREFUSED")
          ? `${this.displayName} is not running at ${this.baseUrl}. Start it and load an embedding model.`
          : `Failed to connect to ${this.displayName} at ${this.baseUrl}: ${cause}`;
      throw new ProviderError(msg, "transient_network", cause);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ProviderError(
        `${this.displayName} embedding API error ${response.status}: ${text}`,
        response.status === 401 ? "auth_failed" : "invalid_request",
      );
    }

    const json = (await response.json()) as EmbeddingResponse;

    if (!json.data || !Array.isArray(json.data)) {
      throw new ProviderError(
        `${this.displayName} embedding response missing data array`,
        "invalid_request",
      );
    }

    return json.data;
  }
}
