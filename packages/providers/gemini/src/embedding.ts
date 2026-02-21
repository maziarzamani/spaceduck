// Gemini embedding provider — uses Google AI text-embedding-004 model
// via the @google/genai SDK for consistent embedding generation.

import type { EmbeddingProvider } from "@spaceduck/core";
import { ProviderError } from "@spaceduck/core";

export interface GeminiEmbeddingConfig {
  /** Google AI Studio API key */
  readonly apiKey: string;
  /** Embedding model. Default: text-embedding-004 */
  readonly model?: string;
}

const DEFAULT_MODEL = "text-embedding-004";
const GEMINI_DIMENSIONS = 768;

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "gemini";
  readonly model: string;
  readonly dimensions = GEMINI_DIMENSIONS;

  private readonly apiKey: string;

  constructor(config: GeminiEmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.callEmbeddingAPI([text]);
    return this.validateAndConvert(results[0]);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    // Gemini embedContent API supports one text at a time,
    // so we batch via batchEmbedContents endpoint
    const results = await this.callBatchEmbeddingAPI(texts);
    return results.map((r) => this.validateAndConvert(r));
  }

  private validateAndConvert(embedding: number[]): Float32Array {
    if (embedding.length !== this.dimensions) {
      throw new ProviderError(
        `Gemini embedding dimension mismatch: expected ${this.dimensions}, got ${embedding.length} from model "${this.model}"`,
        "invalid_request",
      );
    }
    return new Float32Array(embedding);
  }

  private async callEmbeddingAPI(texts: string[]): Promise<number[][]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;

    const results: number[][] = [];

    for (const text of texts) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: `models/${this.model}`,
            content: { parts: [{ text }] },
          }),
        });
      } catch (cause) {
        throw new ProviderError(
          `Failed to connect to Gemini embedding API: ${cause}`,
          "transient_network",
          cause,
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ProviderError(
          `Gemini embedding API error ${response.status}: ${body}`,
          response.status === 401 || response.status === 403 ? "auth_failed" : "invalid_request",
        );
      }

      const json = (await response.json()) as {
        embedding?: { values: number[] };
      };

      if (!json.embedding?.values) {
        throw new ProviderError(
          "Gemini embedding response missing embedding.values",
          "invalid_request",
        );
      }

      results.push(json.embedding.values);
    }

    return results;
  }

  private async callBatchEmbeddingAPI(texts: string[]): Promise<number[][]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;

    const requests = texts.map((text) => ({
      model: `models/${this.model}`,
      content: { parts: [{ text }] },
    }));

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      });
    } catch (cause) {
      throw new ProviderError(
        `Failed to connect to Gemini batch embedding API: ${cause}`,
        "transient_network",
        cause,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderError(
        `Gemini batch embedding API error ${response.status}: ${body}`,
        response.status === 401 || response.status === 403 ? "auth_failed" : "invalid_request",
      );
    }

    const json = (await response.json()) as {
      embeddings?: Array<{ values: number[] }>;
    };

    if (!json.embeddings || !Array.isArray(json.embeddings)) {
      throw new ProviderError(
        "Gemini batch embedding response missing embeddings array",
        "invalid_request",
      );
    }

    return json.embeddings.map((e) => e.values);
  }
}
