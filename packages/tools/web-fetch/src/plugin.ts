import type { ToolPlugin, ToolContribution } from "@spaceduck/core";
import { WebFetchTool } from "./web-fetch-tool";

export const plugin: ToolPlugin = {
  id: "web-fetch",
  displayName: "Web Fetch",
  configKey: "webFetch",
  rebuildOnConfigPaths: ["/tools/webFetch/enabled"],

  async activate(ctx): Promise<readonly ToolContribution[]> {
    const webFetch = new WebFetchTool();
    const log = ctx.logger;

    return [
      {
        definition: {
          name: "web_fetch",
          description:
            "Fetch a URL and return readable text content (HTML, JSON, or plain text). Prefer this when the user gives a specific URL. Returns raw fetched content, not JavaScript-rendered DOM. If the page requires JavaScript, login, or heavy client-side rendering, use browser_navigate instead.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "The URL to fetch" },
            },
            required: ["url"],
          },
        },
        handler: async (args) => {
          const url = args.url as string;
          log.debug("web_fetch", { url });
          return webFetch.fetch(url);
        },
      },
    ];
  },
};
