import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConsoleLogger } from "@spaceduck/core";
import { loadPlugins } from "../loader";
import type { DiscoveredPlugin } from "../discover";

function makeDeps(config: Record<string, unknown> = {}) {
  return {
    logger: new ConsoleLogger("error"),
    config,
    env: {} as Record<string, string | undefined>,
    services: {},
  };
}

describe("loadPlugins", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sd-loader-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads a valid plugin and registers its tools", async () => {
    const pluginDir = join(tempDir, "test-tool");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.ts"),
      `
      export const plugin = {
        id: "test",
        displayName: "Test Tool",
        configKey: "test",
        async activate() {
          return [{
            definition: { name: "test_action", description: "A test", parameters: { type: "object", properties: {} } },
            handler: async () => "ok",
          }];
        },
      };
      `,
    );

    const discovered: DiscoveredPlugin[] = [
      { modulePath: join(pluginDir, "plugin.ts"), dirName: "test-tool" },
    ];

    const result = await loadPlugins(discovered, makeDeps());
    expect(result.registry.size).toBe(1);
    expect(result.registry.has("test_action")).toBe(true);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].id).toBe("test");
    expect(result.plugins[0].toolCount).toBe(1);
  });

  it("skips plugin when disabled in config", async () => {
    const pluginDir = join(tempDir, "disabled-tool");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.ts"),
      `
      export const plugin = {
        id: "disabled",
        displayName: "Disabled",
        configKey: "myTool",
        async activate() {
          return [{ definition: { name: "nope", description: "", parameters: {} }, handler: async () => "" }];
        },
      };
      `,
    );

    const discovered: DiscoveredPlugin[] = [
      { modulePath: join(pluginDir, "plugin.ts"), dirName: "disabled-tool" },
    ];

    const result = await loadPlugins(discovered, makeDeps({
      tools: { myTool: { enabled: false } },
    }));
    expect(result.registry.size).toBe(0);
    expect(result.plugins).toHaveLength(0);
  });

  it("skips plugin when isAvailable returns false", async () => {
    const pluginDir = join(tempDir, "unavailable-tool");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.ts"),
      `
      export const plugin = {
        id: "unavailable",
        displayName: "Unavailable",
        configKey: "unavail",
        async isAvailable() { return { available: false, reason: "missing binary" }; },
        async activate() {
          return [{ definition: { name: "nope", description: "", parameters: {} }, handler: async () => "" }];
        },
      };
      `,
    );

    const discovered: DiscoveredPlugin[] = [
      { modulePath: join(pluginDir, "plugin.ts"), dirName: "unavailable-tool" },
    ];

    const result = await loadPlugins(discovered, makeDeps());
    expect(result.registry.size).toBe(0);
  });

  it("isolates broken plugins without crashing", async () => {
    const goodDir = join(tempDir, "good-tool");
    await mkdir(goodDir, { recursive: true });
    await writeFile(
      join(goodDir, "plugin.ts"),
      `
      export const plugin = {
        id: "good",
        displayName: "Good",
        configKey: "good",
        async activate() {
          return [{ definition: { name: "good_tool", description: "works", parameters: {} }, handler: async () => "ok" }];
        },
      };
      `,
    );

    const discovered: DiscoveredPlugin[] = [
      { modulePath: join(tempDir, "nonexistent/plugin.ts"), dirName: "broken" },
      { modulePath: join(goodDir, "plugin.ts"), dirName: "good-tool" },
    ];

    const result = await loadPlugins(discovered, makeDeps());
    expect(result.registry.size).toBe(1);
    expect(result.registry.has("good_tool")).toBe(true);
  });

  it("skips modules without a plugin export", async () => {
    const noPluginDir = join(tempDir, "no-plugin");
    await mkdir(noPluginDir, { recursive: true });
    await writeFile(
      join(noPluginDir, "index.ts"),
      `export const something = "not a plugin";`,
    );

    const discovered: DiscoveredPlugin[] = [
      { modulePath: join(noPluginDir, "index.ts"), dirName: "no-plugin" },
    ];

    const result = await loadPlugins(discovered, makeDeps());
    expect(result.registry.size).toBe(0);
    expect(result.plugins).toHaveLength(0);
  });

  it("aggregates rebuild paths from multiple plugins", async () => {
    const dir1 = join(tempDir, "tool-a");
    const dir2 = join(tempDir, "tool-b");
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });

    await writeFile(
      join(dir1, "plugin.ts"),
      `
      export const plugin = {
        id: "a",
        displayName: "A",
        configKey: "a",
        rebuildOnConfigPaths: ["/tools/a/enabled"],
        rebuildOnSecretPaths: ["/tools/a/secrets/key"],
        async activate() {
          return [{ definition: { name: "a_tool", description: "", parameters: {} }, handler: async () => "" }];
        },
      };
      `,
    );

    await writeFile(
      join(dir2, "plugin.ts"),
      `
      export const plugin = {
        id: "b",
        displayName: "B",
        configKey: "b",
        rebuildOnConfigPaths: ["/tools/b/enabled"],
        async activate() {
          return [{ definition: { name: "b_tool", description: "", parameters: {} }, handler: async () => "" }];
        },
      };
      `,
    );

    const discovered: DiscoveredPlugin[] = [
      { modulePath: join(dir1, "plugin.ts"), dirName: "tool-a" },
      { modulePath: join(dir2, "plugin.ts"), dirName: "tool-b" },
    ];

    const result = await loadPlugins(discovered, makeDeps());
    expect(result.registry.size).toBe(2);
    expect(result.rebuildConfigPaths.has("/tools/a/enabled")).toBe(true);
    expect(result.rebuildConfigPaths.has("/tools/b/enabled")).toBe(true);
    expect(result.rebuildSecretPaths.has("/tools/a/secrets/key")).toBe(true);
  });

  it("registers multiple contributions from one plugin", async () => {
    const pluginDir = join(tempDir, "multi-tool");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.ts"),
      `
      export const plugin = {
        id: "multi",
        displayName: "Multi",
        configKey: "multi",
        async activate() {
          return [
            { definition: { name: "multi_a", description: "a", parameters: {} }, handler: async () => "a" },
            { definition: { name: "multi_b", description: "b", parameters: {} }, handler: async () => "b" },
            { definition: { name: "multi_c", description: "c", parameters: {} }, handler: async () => "c" },
          ];
        },
      };
      `,
    );

    const discovered: DiscoveredPlugin[] = [
      { modulePath: join(pluginDir, "plugin.ts"), dirName: "multi-tool" },
    ];

    const result = await loadPlugins(discovered, makeDeps());
    expect(result.registry.size).toBe(3);
    expect(result.plugins[0].toolCount).toBe(3);
  });
});
