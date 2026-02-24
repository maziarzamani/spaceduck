import { describe, it, expect, beforeEach, mock } from "bun:test";
import { ToolRegistry, ConsoleLogger } from "@spaceduck/core";
import { ToolStatusService } from "../tools/tools-status";
import type { ToolName } from "../tools/tools-status";

const logger = new ConsoleLogger("error");

// ── shouldRebuildX helpers (re-implemented to test in isolation) ──────

const TOOL_REBUILD_PATHS = new Set([
  "/tools/webSearch/provider",
  "/tools/webSearch/searxngUrl",
  "/tools/webAnswer/enabled",
  "/tools/marker/enabled",
  "/tools/browser/enabled",
  "/tools/webFetch/enabled",
]);

const TOOL_SECRET_PATHS = new Set([
  "/tools/webSearch/secrets/braveApiKey",
  "/tools/webAnswer/secrets/perplexityApiKey",
]);

const AI_SECRETS_AFFECTING_TOOLS = new Set([
  "/ai/secrets/openrouterApiKey",
]);

const CHANNEL_REBUILD_PATHS = new Set([
  "/channels/whatsapp/enabled",
]);

function shouldRebuildTools(changedPaths: Set<string>): boolean {
  for (const p of TOOL_REBUILD_PATHS) {
    if (changedPaths.has(p)) return true;
  }
  return false;
}

function shouldRebuildToolsForSecret(path: string): boolean {
  return TOOL_SECRET_PATHS.has(path) || AI_SECRETS_AFFECTING_TOOLS.has(path);
}

function shouldRebuildChannels(changedPaths: Set<string>): boolean {
  for (const p of CHANNEL_REBUILD_PATHS) {
    if (changedPaths.has(p)) return true;
  }
  return false;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("shouldRebuildTools", () => {
  it("triggers on /tools/webSearch/provider change", () => {
    expect(shouldRebuildTools(new Set(["/tools/webSearch/provider"]))).toBe(true);
  });

  it("triggers on /tools/webSearch/searxngUrl change", () => {
    expect(shouldRebuildTools(new Set(["/tools/webSearch/searxngUrl"]))).toBe(true);
  });

  it("triggers on /tools/webAnswer/enabled change", () => {
    expect(shouldRebuildTools(new Set(["/tools/webAnswer/enabled"]))).toBe(true);
  });

  it("triggers on /tools/marker/enabled change", () => {
    expect(shouldRebuildTools(new Set(["/tools/marker/enabled"]))).toBe(true);
  });

  it("triggers on /tools/browser/enabled change", () => {
    expect(shouldRebuildTools(new Set(["/tools/browser/enabled"]))).toBe(true);
  });

  it("triggers on /tools/webFetch/enabled change", () => {
    expect(shouldRebuildTools(new Set(["/tools/webFetch/enabled"]))).toBe(true);
  });

  it("does not trigger on unrelated path", () => {
    expect(shouldRebuildTools(new Set(["/ai/model", "/ai/temperature"]))).toBe(false);
  });

  it("multiple tool paths in one patch = single boolean check", () => {
    const paths = new Set(["/tools/webSearch/provider", "/tools/webSearch/searxngUrl"]);
    expect(shouldRebuildTools(paths)).toBe(true);
  });
});

describe("shouldRebuildToolsForSecret", () => {
  it("triggers on tool secret path (Brave)", () => {
    expect(shouldRebuildToolsForSecret("/tools/webSearch/secrets/braveApiKey")).toBe(true);
  });

  it("triggers on tool secret path (Perplexity)", () => {
    expect(shouldRebuildToolsForSecret("/tools/webAnswer/secrets/perplexityApiKey")).toBe(true);
  });

  it("triggers on AI secret that affects tools (OpenRouter)", () => {
    expect(shouldRebuildToolsForSecret("/ai/secrets/openrouterApiKey")).toBe(true);
  });

  it("does NOT trigger on unrelated AI secret (Gemini)", () => {
    expect(shouldRebuildToolsForSecret("/ai/secrets/geminiApiKey")).toBe(false);
  });

  it("does NOT trigger on unrelated AI secret (Bedrock)", () => {
    expect(shouldRebuildToolsForSecret("/ai/secrets/bedrockApiKey")).toBe(false);
  });

  it("does NOT trigger on unrelated AI secret (LMStudio)", () => {
    expect(shouldRebuildToolsForSecret("/ai/secrets/lmstudioApiKey")).toBe(false);
  });
});

describe("shouldRebuildChannels", () => {
  it("triggers on /channels/whatsapp/enabled", () => {
    expect(shouldRebuildChannels(new Set(["/channels/whatsapp/enabled"]))).toBe(true);
  });

  it("does not trigger on unrelated path", () => {
    expect(shouldRebuildChannels(new Set(["/ai/model"]))).toBe(false);
  });
});

describe("combined tool + channel rebuild detection", () => {
  it("detects both tool and channel changes in one patch", () => {
    const paths = new Set(["/tools/webSearch/provider", "/channels/whatsapp/enabled"]);
    expect(shouldRebuildTools(paths)).toBe(true);
    expect(shouldRebuildChannels(paths)).toBe(true);
  });

  it("detects only tools when no channel path present", () => {
    const paths = new Set(["/tools/webSearch/provider", "/ai/model"]);
    expect(shouldRebuildTools(paths)).toBe(true);
    expect(shouldRebuildChannels(paths)).toBe(false);
  });
});

describe("ToolStatusService with getter", () => {
  it("reports all tools as not_configured/unavailable when registry is undefined", () => {
    const service = new ToolStatusService(() => undefined);
    const status = service.getStatus();

    expect(status.length).toBe(5);
    for (const entry of status) {
      expect(["not_configured", "unavailable", "disabled"]).toContain(entry.status);
    }
  });

  it("sees swapped registry after getter returns new instance", () => {
    const regA = new ToolRegistry();
    regA.register(
      { name: "web_search", description: "test", parameters: { type: "object", properties: {} } },
      async () => "ok",
    );

    const regB = new ToolRegistry();

    const fakeConfigStore = {
      get current() {
        return { tools: { webSearch: { provider: "brave", searxngUrl: null, secrets: { braveApiKey: "key" } }, webAnswer: { enabled: true, secrets: { perplexityApiKey: null } }, marker: { enabled: true }, browser: { enabled: true }, webFetch: { enabled: true } }, channels: { whatsapp: { enabled: false } } } as any;
      },
    } as any;

    let current: ToolRegistry | undefined = regA;
    const service = new ToolStatusService(() => current, fakeConfigStore);

    const statusA = service.getStatus();
    const wsA = statusA.find((e) => e.tool === "web_search");
    expect(wsA?.status).toBe("ok");

    current = regB;
    const statusB = service.getStatus();
    const wsB = statusB.find((e) => e.tool === "web_search");
    expect(wsB?.status).toBe("not_configured");
  });

  it("probe returns 'Tool not registered' when registry is undefined", async () => {
    const service = new ToolStatusService(() => undefined);
    const result = await service.probe("web_search");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Tool not registered");
  });

  it("reports browser as disabled when config says disabled", () => {
    const fakeConfig = {
      get current() {
        return { tools: { webSearch: { provider: null, searxngUrl: null, secrets: {} }, webAnswer: { enabled: true, secrets: {} }, marker: { enabled: true }, browser: { enabled: false }, webFetch: { enabled: true } } } as any;
      },
    } as any;
    const service = new ToolStatusService(() => undefined, fakeConfig);
    const status = service.getStatus();
    const br = status.find((e) => e.tool === "browser_navigate");
    expect(br?.status).toBe("disabled");
  });

  it("reports web_fetch as disabled when config says disabled", () => {
    const fakeConfig = {
      get current() {
        return { tools: { webSearch: { provider: null, searxngUrl: null, secrets: {} }, webAnswer: { enabled: true, secrets: {} }, marker: { enabled: true }, browser: { enabled: true }, webFetch: { enabled: false } } } as any;
      },
    } as any;
    const service = new ToolStatusService(() => undefined, fakeConfig);
    const status = service.getStatus();
    const wf = status.find((e) => e.tool === "web_fetch");
    expect(wf?.status).toBe("disabled");
  });

  it("reports browser as ok when registered and enabled", () => {
    const reg = new ToolRegistry();
    reg.register(
      { name: "browser_navigate", description: "test", parameters: { type: "object", properties: {} } },
      async () => "ok",
    );
    const fakeConfig = {
      get current() {
        return { tools: { webSearch: { provider: null, searxngUrl: null, secrets: {} }, webAnswer: { enabled: true, secrets: {} }, marker: { enabled: true }, browser: { enabled: true }, webFetch: { enabled: true } } } as any;
      },
    } as any;
    const service = new ToolStatusService(() => reg, fakeConfig);
    const status = service.getStatus();
    const br = status.find((e) => e.tool === "browser_navigate");
    expect(br?.status).toBe("ok");
  });

  it("reports web_fetch as ok when registered and enabled", () => {
    const reg = new ToolRegistry();
    reg.register(
      { name: "web_fetch", description: "test", parameters: { type: "object", properties: {} } },
      async () => "ok",
    );
    const fakeConfig = {
      get current() {
        return { tools: { webSearch: { provider: null, searxngUrl: null, secrets: {} }, webAnswer: { enabled: true, secrets: {} }, marker: { enabled: true }, browser: { enabled: true }, webFetch: { enabled: true } } } as any;
      },
    } as any;
    const service = new ToolStatusService(() => reg, fakeConfig);
    const status = service.getStatus();
    const wf = status.find((e) => e.tool === "web_fetch");
    expect(wf?.status).toBe("ok");
  });

  it("probe returns 'Tool not registered' for browser when registry is undefined", async () => {
    const service = new ToolStatusService(() => undefined);
    const result = await service.probe("browser_navigate");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Tool not registered");
  });

  it("probe returns 'Tool not registered' for web_fetch when registry is undefined", async () => {
    const service = new ToolStatusService(() => undefined);
    const result = await service.probe("web_fetch");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Tool not registered");
  });
});

describe("AgentLoop.setToolRegistry", () => {
  it("swaps the registry and subsequent access returns new instance", async () => {
    const { AgentLoop } = await import("@spaceduck/core");

    const mockProvider = {
      name: "test",
      async *chat() { yield { type: "text" as const, text: "hi" }; },
    };
    const mockConvStore = {
      async appendMessage() { return { ok: true } as any; },
      async getMessages() { return { ok: true, value: [] } as any; },
    };
    const mockCtx = {
      async buildContext() { return { ok: true, value: [] } as any; },
      needsCompaction() { return false; },
    };
    const mockSession = {
      async resolve() { return { conversationId: "test" } as any; },
    };
    const mockEventBus = {
      emit() {},
      on() { return () => {}; },
    };

    const regA = new ToolRegistry();
    const regB = new ToolRegistry();
    regB.register(
      { name: "test_tool", description: "test", parameters: { type: "object", properties: {} } },
      async () => "ok",
    );

    const agent = new AgentLoop({
      provider: mockProvider as any,
      conversationStore: mockConvStore as any,
      contextBuilder: mockCtx as any,
      sessionManager: mockSession as any,
      eventBus: mockEventBus as any,
      logger,
      toolRegistry: regA,
    });

    expect(agent.toolRegistry).toBe(regA);
    expect(agent.toolRegistry?.has("test_tool")).toBe(false);

    agent.setToolRegistry(regB);
    expect(agent.toolRegistry).toBe(regB);
    expect(agent.toolRegistry?.has("test_tool")).toBe(true);
  });
});

describe("buildToolRegistry config-driven behavior", () => {
  it("uses config store values over env when both are present", async () => {
    const { buildToolRegistry } = await import("../tool-registrations");
    const { ConfigStore } = await import("../config/config-store");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const store = new ConfigStore(join(tmpdir(), `test-${Date.now()}`));
    await store.load();

    await store.patch(
      [{ op: "replace", path: "/tools/webSearch/provider", value: "searxng" }],
      store.rev(),
    );
    await store.patch(
      [{ op: "replace", path: "/tools/webSearch/searxngUrl", value: "http://localhost:9000" }],
      store.rev(),
    );

    const registry = buildToolRegistry(logger, undefined, store);
    expect(registry.has("web_search")).toBe(true);
  });

  it("does not register web_search when provider is null and no env", () => {
    const { buildToolRegistry } = require("../tool-registrations");
    const registry = buildToolRegistry(logger);
    expect(registry.has("web_search")).toBe(false);
  });

  it("does not register web_answer when disabled in config", async () => {
    const { buildToolRegistry } = await import("../tool-registrations");
    const { ConfigStore } = await import("../config/config-store");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const store = new ConfigStore(join(tmpdir(), `test-${Date.now()}`));
    await store.load();

    await store.patch(
      [{ op: "replace", path: "/tools/webAnswer/enabled", value: false }],
      store.rev(),
    );

    const registry = buildToolRegistry(logger, undefined, store);
    expect(registry.has("web_answer")).toBe(false);
  });

  it("does not register browser tools when disabled in config", async () => {
    const { buildToolRegistry } = await import("../tool-registrations");
    const { ConfigStore } = await import("../config/config-store");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const store = new ConfigStore(join(tmpdir(), `test-${Date.now()}`));
    await store.load();

    await store.patch(
      [{ op: "replace", path: "/tools/browser/enabled", value: false }],
      store.rev(),
    );

    const registry = buildToolRegistry(logger, undefined, store);
    expect(registry.has("browser_navigate")).toBe(false);
    expect(registry.has("browser_snapshot")).toBe(false);
    expect(registry.has("browser_click")).toBe(false);
  });

  it("does not register web_fetch when disabled in config", async () => {
    const { buildToolRegistry } = await import("../tool-registrations");
    const { ConfigStore } = await import("../config/config-store");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const store = new ConfigStore(join(tmpdir(), `test-${Date.now()}`));
    await store.load();

    await store.patch(
      [{ op: "replace", path: "/tools/webFetch/enabled", value: false }],
      store.rev(),
    );

    const registry = buildToolRegistry(logger, undefined, store);
    expect(registry.has("web_fetch")).toBe(false);
  });

  it("registers browser tools and web_fetch by default", () => {
    const { buildToolRegistry } = require("../tool-registrations");
    const registry = buildToolRegistry(logger);
    expect(registry.has("browser_navigate")).toBe(true);
    expect(registry.has("browser_snapshot")).toBe(true);
    expect(registry.has("web_fetch")).toBe(true);
  });
});
