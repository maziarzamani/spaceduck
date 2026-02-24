import { describe, test, expect } from "bun:test";
import { ToolRegistry, type ToolHandler } from "../tool-registry";
import type { ToolDefinition } from "../types/tool";

function makeDef(name: string, description = `${name} tool`): ToolDefinition {
  return { name, description, parameters: { type: "object", properties: {} } };
}

describe("ToolRegistry", () => {
  describe("register / has / size", () => {
    test("registers a tool and reports it exists", () => {
      const reg = new ToolRegistry();
      const handler: ToolHandler = async () => "ok";
      reg.register(makeDef("alpha"), handler);

      expect(reg.has("alpha")).toBe(true);
      expect(reg.has("beta")).toBe(false);
      expect(reg.size).toBe(1);
    });

    test("throws on duplicate registration", () => {
      const reg = new ToolRegistry();
      reg.register(makeDef("dup"), async () => "");
      expect(() => reg.register(makeDef("dup"), async () => "")).toThrow(
        'Tool "dup" is already registered',
      );
    });

    test("tracks size across multiple registrations", () => {
      const reg = new ToolRegistry();
      reg.register(makeDef("a"), async () => "");
      reg.register(makeDef("b"), async () => "");
      reg.register(makeDef("c"), async () => "");
      expect(reg.size).toBe(3);
    });
  });

  describe("getDefinitions", () => {
    test("returns all definitions without filter", () => {
      const reg = new ToolRegistry();
      reg.register(makeDef("x"), async () => "");
      reg.register(makeDef("y"), async () => "");
      const defs = reg.getDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs.map((d) => d.name).sort()).toEqual(["x", "y"]);
    });

    test("filters by allow list", () => {
      const reg = new ToolRegistry();
      reg.register(makeDef("a"), async () => "");
      reg.register(makeDef("b"), async () => "");
      reg.register(makeDef("c"), async () => "");

      const defs = reg.getDefinitions({ allow: ["a", "c"] });
      expect(defs.map((d) => d.name).sort()).toEqual(["a", "c"]);
    });

    test("filters by deny list", () => {
      const reg = new ToolRegistry();
      reg.register(makeDef("a"), async () => "");
      reg.register(makeDef("b"), async () => "");
      reg.register(makeDef("c"), async () => "");

      const defs = reg.getDefinitions({ deny: ["b"] });
      expect(defs.map((d) => d.name).sort()).toEqual(["a", "c"]);
    });

    test("applies allow then deny when both specified", () => {
      const reg = new ToolRegistry();
      reg.register(makeDef("a"), async () => "");
      reg.register(makeDef("b"), async () => "");
      reg.register(makeDef("c"), async () => "");

      const defs = reg.getDefinitions({ allow: ["a", "b"], deny: ["b"] });
      expect(defs.map((d) => d.name)).toEqual(["a"]);
    });

    test("returns empty when allow list has no matches", () => {
      const reg = new ToolRegistry();
      reg.register(makeDef("a"), async () => "");
      expect(reg.getDefinitions({ allow: ["z"] })).toEqual([]);
    });
  });

  describe("execute", () => {
    test("executes a registered tool and returns result", async () => {
      const reg = new ToolRegistry();
      reg.register(makeDef("greet"), async (args) => `Hello ${args.name}`);

      const result = await reg.execute({
        id: "call-1",
        name: "greet",
        args: { name: "World" },
      });

      expect(result.toolCallId).toBe("call-1");
      expect(result.name).toBe("greet");
      expect(result.content).toBe("Hello World");
      expect(result.isError).toBeUndefined();
    });

    test("returns error for unknown tool", async () => {
      const reg = new ToolRegistry();
      reg.register(makeDef("known"), async () => "");

      const result = await reg.execute({
        id: "call-2",
        name: "unknown_tool",
        args: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Unknown tool "unknown_tool"');
      expect(result.content).toContain("known");
    });

    test("captures handler errors without throwing", async () => {
      const reg = new ToolRegistry();
      reg.register(makeDef("fail"), async () => {
        throw new Error("boom");
      });

      const result = await reg.execute({
        id: "call-3",
        name: "fail",
        args: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("boom");
      expect(result.content).toContain('Error executing "fail"');
    });

    test("captures non-Error throws", async () => {
      const reg = new ToolRegistry();
      reg.register(makeDef("fail2"), async () => {
        throw "string error";
      });

      const result = await reg.execute({
        id: "call-4",
        name: "fail2",
        args: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("string error");
    });

    test("truncates oversized results", async () => {
      const reg = new ToolRegistry({ maxResultChars: 20 });
      reg.register(makeDef("big"), async () => "a".repeat(100));

      const result = await reg.execute({ id: "call-5", name: "big", args: {} });

      expect(result.content.length).toBeLessThan(100);
      expect(result.content).toEndWith("[truncated]");
      expect(result.content).toStartWith("a".repeat(20));
    });

    test("does not truncate results under the limit", async () => {
      const reg = new ToolRegistry({ maxResultChars: 200 });
      reg.register(makeDef("small"), async () => "short result");

      const result = await reg.execute({ id: "call-6", name: "small", args: {} });
      expect(result.content).toBe("short result");
    });

    test("uses default maxResultChars of 50000", async () => {
      const reg = new ToolRegistry();
      reg.register(makeDef("medium"), async () => "x".repeat(49_999));

      const result = await reg.execute({ id: "call-7", name: "medium", args: {} });
      expect(result.content).toBe("x".repeat(49_999));
    });
  });
});
