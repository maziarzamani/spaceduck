// Plugin loader — loads discovered plugins and populates a ToolRegistry

import {
  ToolRegistry,
  type Logger,
  type ToolPlugin,
  type ToolPluginContext,
  type ToolPluginServices,
} from "@spaceduck/core";
import type { DiscoveredPlugin } from "./discover";

export interface PluginLoaderDeps {
  readonly logger: Logger;
  readonly config: Record<string, unknown>;
  readonly env: Record<string, string | undefined>;
  readonly services: ToolPluginServices;
}

export interface LoadedPluginInfo {
  readonly id: string;
  readonly toolCount: number;
  readonly rebuildOnConfigPaths: readonly string[];
  readonly rebuildOnSecretPaths: readonly string[];
}

export interface LoadResult {
  readonly registry: ToolRegistry;
  readonly plugins: readonly LoadedPluginInfo[];
  readonly rebuildConfigPaths: ReadonlySet<string>;
  readonly rebuildSecretPaths: ReadonlySet<string>;
}

export async function loadPlugins(
  discovered: DiscoveredPlugin[],
  deps: PluginLoaderDeps,
): Promise<LoadResult> {
  const registry = new ToolRegistry();
  const log = deps.logger.child({ component: "PluginLoader" });
  const loadedPlugins: LoadedPluginInfo[] = [];
  const allConfigPaths = new Set<string>();
  const allSecretPaths = new Set<string>();

  for (const disc of discovered) {
    try {
      const mod = await import(disc.modulePath);
      const plugin: ToolPlugin | undefined = mod.plugin ?? mod.default?.plugin;

      if (!plugin || !plugin.id || !plugin.activate) {
        log.debug("Skipping non-plugin package", { path: disc.modulePath });
        continue;
      }

      const toolsConfig =
        (deps.config as Record<string, unknown>).tools as
          | Record<string, unknown>
          | undefined;
      const pluginConfig = (toolsConfig?.[plugin.configKey] ?? {}) as Record<
        string,
        unknown
      >;
      const enabled = (pluginConfig.enabled as boolean) ?? true;

      if (!enabled) {
        log.debug("Plugin disabled in config", { pluginId: plugin.id });
        continue;
      }

      if (plugin.isAvailable) {
        const avail = await plugin.isAvailable();
        if (!avail.available) {
          log.debug("Plugin not available", {
            pluginId: plugin.id,
            reason: avail.reason,
          });
          continue;
        }
      }

      const ctx: ToolPluginContext = {
        logger: log.child({ plugin: plugin.id }),
        config: pluginConfig,
        globalConfig: deps.config,
        env: deps.env,
        services: deps.services,
      };

      const contributions = await plugin.activate(ctx);

      for (const contrib of contributions) {
        registry.register(contrib.definition, contrib.handler);
      }

      for (const p of plugin.rebuildOnConfigPaths ?? []) allConfigPaths.add(p);
      for (const p of plugin.rebuildOnSecretPaths ?? []) allSecretPaths.add(p);

      loadedPlugins.push({
        id: plugin.id,
        toolCount: contributions.length,
        rebuildOnConfigPaths: plugin.rebuildOnConfigPaths ?? [],
        rebuildOnSecretPaths: plugin.rebuildOnSecretPaths ?? [],
      });

      log.info("Plugin activated", {
        pluginId: plugin.id,
        tools: contributions.length,
      });
    } catch (e) {
      log.error("Plugin load failed", {
        path: disc.modulePath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  log.info("Plugin loading complete", {
    totalPlugins: loadedPlugins.length,
    totalTools: registry.size,
  });

  return {
    registry,
    plugins: loadedPlugins,
    rebuildConfigPaths: allConfigPaths,
    rebuildSecretPaths: allSecretPaths,
  };
}
