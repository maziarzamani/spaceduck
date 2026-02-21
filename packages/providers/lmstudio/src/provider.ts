// LM Studio provider — connects to a local LM Studio instance via its
// OpenAI-compatible /v1/chat/completions endpoint.
//
// Thin wrapper over OpenAICompatibleProvider with LM Studio defaults:
//   • No API key required (passes a dummy "lm-studio" key for servers that
//     require the Authorization header to be present)
//   • Default URL: http://localhost:1234/v1
//   • <think>…</think> stripping enabled (for Qwen3 thinking models)
//   • Tool-less fallback enabled (converts tool messages to plain text when
//     tools are not sent in post-tool-execution rounds)

import { OpenAICompatibleProvider } from "@spaceduck/provider-openai-compat";

export interface LMStudioProviderConfig {
  /** Model identifier as shown in LM Studio, e.g. "qwen/qwen3-4b-thinking-2507" */
  readonly model: string;
  /** Base URL including the /v1 prefix. Default: http://localhost:1234/v1 */
  readonly baseUrl?: string;
  /** Optional API key (LM Studio doesn't require one by default) */
  readonly apiKey?: string;
}

export class LMStudioProvider extends OpenAICompatibleProvider {
  constructor(config: LMStudioProviderConfig) {
    super({
      name: "lmstudio",
      model: config.model,
      baseUrl: config.baseUrl ?? "http://localhost:1234/v1",
      apiKey: config.apiKey ?? "lm-studio",
      stripThinkTags: true,
      toolFallback: "strip",
    });
  }
}
