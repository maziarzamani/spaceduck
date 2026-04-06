import type { ToolPlugin, ToolContribution } from "@spaceduck/core";
import { WebSearchTool, type SearchProvider } from "./web-search-tool";
import { WebAnswerTool } from "./web-answer-tool";

export const plugin: ToolPlugin = {
  id: "web-search",
  displayName: "Web Search",
  configKey: "webSearch",
  rebuildOnConfigPaths: [
    "/tools/webSearch/provider",
    "/tools/webSearch/searxngUrl",
    "/tools/webAnswer/enabled",
  ],
  rebuildOnSecretPaths: [
    "/tools/webSearch/secrets/braveApiKey",
    "/tools/webAnswer/secrets/perplexityApiKey",
  ],

  async activate(ctx): Promise<readonly ToolContribution[]> {
    const log = ctx.logger;
    const contributions: ToolContribution[] = [];

    // web_search
    const braveApiKey =
      (ctx.config.secrets as Record<string, unknown> | undefined)?.braveApiKey as string | undefined ??
      ctx.env.BRAVE_API_KEY;
    const searxngUrl =
      (ctx.config.searxngUrl as string | undefined) ?? ctx.env.SEARXNG_URL;
    const envProvider = ctx.env.SEARCH_PROVIDER;
    const provider: SearchProvider | null =
      (ctx.config.provider as SearchProvider | null) ??
      (envProvider === "brave" || envProvider === "searxng" ? envProvider : null);

    if ((braveApiKey || searxngUrl) && provider) {
      const webSearch = new WebSearchTool({
        provider,
        braveApiKey,
        searxngUrl,
        searxngUserAgent: ctx.env.SEARXNG_USER_AGENT,
      });

      contributions.push({
        definition: {
          name: "web_search",
          description:
            "Search the web and return ranked results (title, URL, snippet, optional date). Use this to find sources, compare pages, or gather links. This tool does not synthesize a final answer. For a direct cited answer, use web_answer.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query." },
              count: {
                type: "integer",
                minimum: 1,
                maximum: 10,
                description: "Number of results to return (1-10, default 5).",
              },
              freshness: {
                type: "string",
                enum: ["pd", "pw", "pm", "py"],
                description: "Freshness filter: pd=past day, pw=past week, pm=past month, py=past year.",
              },
              country: {
                type: "string",
                description: 'Country code for region-specific results (e.g. "DK", "US").',
              },
              searchLang: {
                type: "string",
                description: 'Language code for results (e.g. "da", "en", "da-DK").',
              },
            },
            required: ["query"],
            additionalProperties: false,
          },
        },
        handler: async (args) => {
          log.debug("web_search", { query: args.query, provider });
          return webSearch.search(args.query as string, {
            count: args.count as number | undefined,
            freshness: args.freshness as "pd" | "pw" | "pm" | "py" | undefined,
            country: args.country as string | undefined,
            searchLang: args.searchLang as string | undefined,
          });
        },
      });
    }

    // web_answer
    const globalConfig = ctx.globalConfig as Record<string, unknown>;
    const aiConfig = (globalConfig.ai as Record<string, unknown> | undefined);
    const aiSecrets = (aiConfig?.secrets as Record<string, unknown> | undefined);
    const webAnswerConfig = (
      (globalConfig.tools as Record<string, unknown> | undefined)?.webAnswer as Record<string, unknown> | undefined
    ) ?? {};
    const webAnswerEnabled = (webAnswerConfig.enabled as boolean) ?? true;
    const perplexityApiKey =
      ((webAnswerConfig.secrets as Record<string, unknown> | undefined)?.perplexityApiKey as string | undefined) ??
      ctx.env.PERPLEXITY_API_KEY;
    const openrouterApiKey =
      (aiSecrets?.openrouterApiKey as string | undefined) ?? ctx.env.OPENROUTER_API_KEY;

    if (webAnswerEnabled && (perplexityApiKey || openrouterApiKey)) {
      const webAnswer = new WebAnswerTool({ perplexityApiKey, openrouterApiKey });

      contributions.push({
        definition: {
          name: "web_answer",
          description:
            "Answer a factual question using live web search and return a concise response with sources when available. Use this when the user wants a direct answer. Prefer web_search when you need to inspect or compare sources manually.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Question to answer." },
              searchLang: {
                type: "string",
                description: 'Language code (e.g. "da", "en", "da-DK").',
              },
            },
            required: ["query"],
            additionalProperties: false,
          },
        },
        handler: async (args) => {
          log.debug("web_answer", { query: args.query });
          return webAnswer.answer(args.query as string, {
            searchLang: args.searchLang as string | undefined,
          });
        },
      });
    }

    return contributions;
  },
};
