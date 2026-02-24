import { describe, it, expect } from "bun:test";
import { buildToolRegistry } from "../tool-registrations";
import { ConsoleLogger } from "@spaceduck/core";
import { ConfigStore } from "../config/config-store";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeConfigStore() {
  // Use a temp dir so ConfigStore won't try to read from the real data/config path
  return new ConfigStore(join(tmpdir(), `spaceduck-test-${Date.now()}`));
}

async function makeLoadedConfigStore() {
  const store = makeConfigStore();
  await store.load();
  return store;
}

describe("config_set tool — JSON schema (llama.cpp compatibility)", () => {
  it("registers config_set with a typed 'value' property", () => {
    const logger = new ConsoleLogger("error");
    const configStore = makeConfigStore();
    const registry = buildToolRegistry(logger, undefined, configStore);

    const defs = registry.getDefinitions();
    const configSet = defs.find((d) => d.name === "config_set");
    expect(configSet).toBeDefined();

    const valueSchema = (configSet!.parameters.properties as Record<string, unknown>)?.value as Record<string, unknown>;
    expect(valueSchema).toBeDefined();

    // Must have an explicit type so llama.cpp schema conversion doesn't fail
    expect(valueSchema.type).toBeDefined();
  });

  it("config_set value type includes all JSON primitive types", () => {
    const logger = new ConsoleLogger("error");
    const configStore = makeConfigStore();
    const registry = buildToolRegistry(logger, undefined, configStore);

    const defs = registry.getDefinitions();
    const configSet = defs.find((d) => d.name === "config_set");
    const valueSchema = (configSet!.parameters.properties as Record<string, unknown>)?.value as Record<string, unknown>;
    const types = valueSchema.type as string[];

    expect(types).toContain("string");
    expect(types).toContain("number");
    expect(types).toContain("boolean");
    expect(types).toContain("null");
  });

  it("no tool property schema is missing a type (llama.cpp guard)", () => {
    const logger = new ConsoleLogger("error");
    const configStore = makeConfigStore();
    const registry = buildToolRegistry(logger, undefined, configStore);

    const defs = registry.getDefinitions();
    const violations: string[] = [];

    for (const def of defs) {
      const props = (def.parameters.properties as Record<string, unknown>) ?? {};
      for (const [propName, propSchema] of Object.entries(props)) {
        const schema = propSchema as Record<string, unknown>;
        if (!schema.type && !schema.$ref && !schema.oneOf && !schema.anyOf) {
          violations.push(`${def.name}.${propName}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("config_set rejects secret paths", async () => {
    const logger = new ConsoleLogger("error");
    const configStore = makeConfigStore();
    const registry = buildToolRegistry(logger, undefined, configStore);

    const result = await registry.execute({
      id: "test-1",
      name: "config_set",
      args: { path: "/ai/secrets/geminiApiKey", value: "sk-test" },
    });

    expect(result.content).toMatch(/[Ss]ecret/);
  });
});

describe("tool handler execution", () => {
  it("registers core tools without configStore or attachmentStore", () => {
    const logger = new ConsoleLogger("error");
    const registry = buildToolRegistry(logger);

    const defs = registry.getDefinitions();
    const names = defs.map((d) => d.name);

    expect(names).toContain("web_fetch");
    expect(names).toContain("browser_navigate");
    expect(names).toContain("browser_snapshot");
    expect(names).toContain("browser_click");
    expect(names).toContain("browser_type");
    expect(names).toContain("browser_scroll");
    expect(names).toContain("browser_wait");
    expect(names).toContain("browser_evaluate");
  });

  it("does not register config_get/config_set without configStore", () => {
    const logger = new ConsoleLogger("error");
    const registry = buildToolRegistry(logger);

    expect(registry.has("config_get")).toBe(false);
    expect(registry.has("config_set")).toBe(false);
  });

  it("registers config_get and config_set when configStore is provided", () => {
    const logger = new ConsoleLogger("error");
    const configStore = makeConfigStore();
    const registry = buildToolRegistry(logger, undefined, configStore);

    expect(registry.has("config_get")).toBe(true);
    expect(registry.has("config_set")).toBe(true);
  });

  it("config_get returns full config when no path given", async () => {
    const logger = new ConsoleLogger("error");
    const configStore = await makeLoadedConfigStore();
    const registry = buildToolRegistry(logger, undefined, configStore);

    const result = await registry.execute({
      id: "test-get-full",
      name: "config_get",
      args: {},
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content);
    expect(parsed.config).toBeDefined();
    expect(parsed.rev).toBeDefined();
  });

  it("config_get resolves a specific path", async () => {
    const logger = new ConsoleLogger("error");
    const configStore = await makeLoadedConfigStore();
    const registry = buildToolRegistry(logger, undefined, configStore);

    const result = await registry.execute({
      id: "test-get-path",
      name: "config_get",
      args: { path: "/ai" },
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content);
    expect(parsed.path).toBe("/ai");
    expect(parsed.value).toBeDefined();
  });

  it("config_get returns error for invalid path", async () => {
    const logger = new ConsoleLogger("error");
    const configStore = await makeLoadedConfigStore();
    const registry = buildToolRegistry(logger, undefined, configStore);

    const result = await registry.execute({
      id: "test-get-invalid",
      name: "config_get",
      args: { path: "/nonexistent/deep/path" },
    });

    expect(result.content).toContain("does not exist");
  });

  it("config_set updates a valid config path", async () => {
    const logger = new ConsoleLogger("error");
    const configStore = await makeLoadedConfigStore();
    const registry = buildToolRegistry(logger, undefined, configStore);

    const result = await registry.execute({
      id: "test-set",
      name: "config_set",
      args: { path: "/ai/model", value: "test-model" },
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content);
    expect(parsed.ok).toBe(true);
    expect(parsed.path).toBe("/ai/model");
    expect(parsed.value).toBe("test-model");
  });

  it("web_fetch returns error for unknown tool", async () => {
    const logger = new ConsoleLogger("error");
    const registry = buildToolRegistry(logger);

    const result = await registry.execute({
      id: "test-unknown",
      name: "nonexistent_tool",
      args: {},
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unknown tool");
  });
});
