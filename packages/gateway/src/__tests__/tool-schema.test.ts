import { describe, it, expect } from "bun:test";
import { createToolRegistry } from "../tool-registrations";
import { ConsoleLogger } from "@spaceduck/core";
import { ConfigStore } from "../config/config-store";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeConfigStore() {
  // Use a temp dir so ConfigStore won't try to read from the real data/config path
  return new ConfigStore(join(tmpdir(), `spaceduck-test-${Date.now()}`));
}

describe("config_set tool — JSON schema (llama.cpp compatibility)", () => {
  it("registers config_set with a typed 'value' property", () => {
    const logger = new ConsoleLogger("error");
    const configStore = makeConfigStore();
    const registry = createToolRegistry(logger, undefined, configStore);

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
    const registry = createToolRegistry(logger, undefined, configStore);

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
    const registry = createToolRegistry(logger, undefined, configStore);

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
    const registry = createToolRegistry(logger, undefined, configStore);

    const result = await registry.execute({
      id: "test-1",
      name: "config_set",
      args: { path: "/ai/secrets/geminiApiKey", value: "sk-test" },
    });

    expect(result.content).toMatch(/[Ss]ecret/);
  });
});
