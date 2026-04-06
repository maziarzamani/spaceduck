// Plugin discovery — scans tool directories for plugin packages

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ok, err, SpaceduckError } from "@spaceduck/core";
import type { Result } from "@spaceduck/core";

export interface DiscoveredPlugin {
  readonly modulePath: string;
  readonly dirName: string;
}

export async function discoverPlugins(
  toolsDir: string,
): Promise<Result<DiscoveredPlugin[], SpaceduckError>> {
  const resolved = resolve(toolsDir);
  try {
    const entries = await readdir(resolved, { withFileTypes: true });
    const plugins: DiscoveredPlugin[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = join(resolved, entry.name, "package.json");
      try {
        const pkgFile = Bun.file(pkgJsonPath);
        if (!(await pkgFile.exists())) continue;
        const pkg = await pkgFile.json();
        const main = pkg.main ?? "src/index.ts";
        plugins.push({
          modulePath: join(resolved, entry.name, main),
          dirName: entry.name,
        });
      } catch {
        // Skip malformed packages
      }
    }

    return ok(plugins);
  } catch (e) {
    return err(
      new SpaceduckError(
        `Failed to scan tools directory: ${resolved}`,
        "PLUGIN_DISCOVER_ERROR",
        e,
      ),
    );
  }
}
