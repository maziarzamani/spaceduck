// Tool plugin system — interface for dynamically loaded tool plugins

import type { ToolDefinition } from "./tool";
import type { ToolHandler } from "../tool-registry";
import type { Logger } from "./logger";

/**
 * Context provided to every tool plugin at activation time.
 */
export interface ToolPluginContext {
  readonly logger: Logger;
  readonly config: Record<string, unknown>;
  readonly globalConfig: Record<string, unknown>;
  readonly env: Record<string, string | undefined>;
  readonly services: ToolPluginServices;
}

/**
 * Optional services a plugin may consume.
 * Uses structural typing to avoid importing gateway types.
 */
export interface ToolPluginServices {
  readonly attachmentStore?: { resolve(id: string): string | null };
  readonly browserPool?: { acquire(conversationId: string): Promise<unknown> };
  readonly getConversationId?: () => string;
}

/**
 * A single tool contribution from a plugin.
 * One plugin may register multiple tools (e.g. browser registers 7).
 */
export interface ToolContribution {
  readonly definition: ToolDefinition;
  readonly handler: ToolHandler;
}

/**
 * Static manifest exported by every tool plugin module.
 */
export interface ToolPlugin {
  readonly id: string;
  readonly displayName: string;
  readonly configKey: string;
  readonly rebuildOnConfigPaths?: readonly string[];
  readonly rebuildOnSecretPaths?: readonly string[];
  isAvailable?(): Promise<{ available: true } | { available: false; reason: string }>;
  activate(ctx: ToolPluginContext): Promise<readonly ToolContribution[]>;
}
