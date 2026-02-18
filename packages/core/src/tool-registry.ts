// ToolRegistry: manages tool definitions + handlers, executes tool calls

import type { ToolDefinition, ToolCall, ToolResult } from "./types/tool";

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

const DEFAULT_MAX_RESULT_CHARS = 50_000;

export class ToolRegistry {
  private tools = new Map<string, { definition: ToolDefinition; handler: ToolHandler }>();
  private maxResultChars: number;

  constructor(options?: { maxResultChars?: number }) {
    this.maxResultChars = options?.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
  }

  /**
   * Register a tool with its definition and handler function.
   */
  register(definition: ToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered`);
    }
    this.tools.set(definition.name, { definition, handler });
  }

  /**
   * Get all tool definitions, optionally filtered by allow/deny lists.
   */
  getDefinitions(filter?: { allow?: string[]; deny?: string[] }): ToolDefinition[] {
    let defs = Array.from(this.tools.values()).map((t) => t.definition);

    if (filter?.allow) {
      const allowed = new Set(filter.allow);
      defs = defs.filter((d) => allowed.has(d.name));
    }
    if (filter?.deny) {
      const denied = new Set(filter.deny);
      defs = defs.filter((d) => !denied.has(d.name));
    }

    return defs;
  }

  /**
   * Execute a tool call and return the result.
   * Never throws -- errors are captured in the result content.
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    const entry = this.tools.get(call.name);
    if (!entry) {
      return {
        toolCallId: call.id,
        name: call.name,
        content: `Error: Unknown tool "${call.name}". Available tools: ${Array.from(this.tools.keys()).join(", ")}`,
        isError: true,
      };
    }

    try {
      let content = await entry.handler(call.args);

      // Truncate oversized results
      if (content.length > this.maxResultChars) {
        content = content.slice(0, this.maxResultChars) + "\n[truncated]";
      }

      return { toolCallId: call.id, name: call.name, content };
    } catch (err) {
      return {
        toolCallId: call.id,
        name: call.name,
        content: `Error executing "${call.name}": ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get the number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }
}
