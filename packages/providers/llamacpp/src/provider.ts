// llamacpp provider — connects to a local llama-server instance via its
// OpenAI-compatible /v1/chat/completions endpoint.
//
// Usage: start llama-server first:
//   llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080
//   Endpoint: http://localhost:8080/v1/chat/completions
//
// If responses look wrong, try adding --chat-template to the llama-server command.
//
// Thin wrapper over OpenAICompatibleProvider with llama-server defaults:
//   • No API key required by default
//   • Default URL: http://127.0.0.1:8080/v1
//   • model defaults to null (omitted from request body) — llama-server with a
//     single loaded model doesn't need it
//   • <think>…</think> stripping enabled (for Qwen/DeepSeek thinking models)
//   • Tool-less fallback enabled (tool calling varies by model and server config)

import { OpenAICompatibleProvider } from "@spaceduck/provider-openai-compat";

export interface LlamaCppProviderConfig {
  /**
   * Model identifier. Optional — llama-server typically ignores this when
   * running a single model. Leave unset or null to omit from the request.
   */
  readonly model?: string | null;
  /**
   * Base URL for the llama-server API. Accepts any of:
   *   http://127.0.0.1:8080
   *   http://127.0.0.1:8080/v1
   *   http://127.0.0.1:8080/v1/chat/completions
   * Default: http://127.0.0.1:8080/v1
   */
  readonly baseUrl?: string;
  /**
   * Optional API key. Most local deployments don't require one, but useful
   * when llama-server is behind a reverse proxy with authentication.
   */
  readonly apiKey?: string;
}

export class LlamaCppProvider extends OpenAICompatibleProvider {
  constructor(config: LlamaCppProviderConfig = {}) {
    super({
      name: "llamacpp",
      model: config.model ?? null,
      baseUrl: config.baseUrl ?? "http://127.0.0.1:8080/v1",
      apiKey: config.apiKey,
      stripThinkTags: true,
      toolFallback: "strip",
    });
  }
}
