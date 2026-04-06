import type { ToolPlugin, ToolContribution } from "@spaceduck/core";
import { MarkerTool } from "./marker-tool";

export const plugin: ToolPlugin = {
  id: "marker",
  displayName: "Marker PDF",
  configKey: "marker",
  rebuildOnConfigPaths: ["/tools/marker/enabled"],

  async isAvailable() {
    const available = await MarkerTool.isAvailable();
    return available
      ? { available: true as const }
      : { available: false as const, reason: "marker_single not on PATH" };
  },

  async activate(ctx): Promise<readonly ToolContribution[]> {
    const log = ctx.logger;
    const { attachmentStore } = ctx.services;

    if (!attachmentStore) {
      log.debug("marker_scan skipped: no attachmentStore");
      return [];
    }

    const marker = new MarkerTool();

    return [
      {
        definition: {
          name: "marker_scan",
          description:
            "Convert a PDF document to markdown. Use when the user uploads a PDF or asks to read/summarize a document. Requires an attachmentId from a file the user uploaded.",
          parameters: {
            type: "object",
            properties: {
              attachmentId: { type: "string", description: "The attachment ID from the uploaded file." },
              pageRange: { type: "string", description: "Optional page range, e.g. '0-5' for first 6 pages." },
              forceOcr: { type: "boolean", description: "Force OCR even for text-based PDFs." },
            },
            required: ["attachmentId"],
          },
        },
        handler: async (args) => {
          const path = attachmentStore.resolve(args.attachmentId as string);
          if (!path) return "Error: attachment not found or expired.";
          log.debug("marker_scan", { attachmentId: args.attachmentId });
          return marker.convert(path, {
            pageRange: args.pageRange as string | undefined,
            forceOcr: args.forceOcr as boolean | undefined,
          });
        },
      },
    ];
  },
};
