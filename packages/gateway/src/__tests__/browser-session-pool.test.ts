import { describe, it, expect, beforeEach, mock } from "bun:test";
import { BrowserSessionPool } from "../browser-session-pool";

function createMockConfigStore(overrides: { sessionIdleTimeoutMs?: number; maxSessions?: number | null } = {}) {
  return {
    current: {
      tools: {
        browser: {
          sessionIdleTimeoutMs: overrides.sessionIdleTimeoutMs ?? 600_000,
          maxSessions: overrides.maxSessions ?? null,
        },
      },
    },
  } as any;
}

function createMockLogger() {
  return {
    child: () => createMockLogger(),
    info: () => {},
    warn: () => {},
    debug: () => {},
    error: () => {},
  } as any;
}

// Mock BrowserTool at module level so pool uses mock instances
const launchMock = mock(() => Promise.resolve());
const closeMock = mock(() => Promise.resolve());
let instanceCount = 0;

mock.module("@spaceduck/tool-browser", () => ({
  BrowserTool: class MockBrowserTool {
    id = ++instanceCount;
    headless: boolean;
    constructor(opts: { headless: boolean }) {
      this.headless = opts.headless;
    }
    launch = launchMock;
    close = closeMock;
  },
}));

describe("BrowserSessionPool", () => {
  beforeEach(() => {
    instanceCount = 0;
    launchMock.mockClear();
    closeMock.mockClear();
  });

  it("acquire creates a new browser for a conversation", async () => {
    const pool = new BrowserSessionPool({
      configStore: createMockConfigStore(),
      logger: createMockLogger(),
    });

    const browser = await pool.acquire("conv-1");
    expect(browser).toBeTruthy();
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(pool.activeSessions).toBe(1);
  });

  it("acquire returns the same browser for the same conversation", async () => {
    const pool = new BrowserSessionPool({
      configStore: createMockConfigStore(),
      logger: createMockLogger(),
    });

    const b1 = await pool.acquire("conv-1");
    const b2 = await pool.acquire("conv-1");
    expect(b1).toBe(b2);
    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it("acquire creates separate browsers for different conversations", async () => {
    const pool = new BrowserSessionPool({
      configStore: createMockConfigStore(),
      logger: createMockLogger(),
    });

    const b1 = await pool.acquire("conv-1");
    const b2 = await pool.acquire("conv-2");
    expect(b1).not.toBe(b2);
    expect(launchMock).toHaveBeenCalledTimes(2);
    expect(pool.activeSessions).toBe(2);
  });

  it("release closes the browser and removes from pool", async () => {
    const pool = new BrowserSessionPool({
      configStore: createMockConfigStore(),
      logger: createMockLogger(),
    });

    await pool.acquire("conv-1");
    expect(pool.activeSessions).toBe(1);

    await pool.release("conv-1");
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(pool.activeSessions).toBe(0);
  });

  it("release is a no-op for unknown conversation", async () => {
    const pool = new BrowserSessionPool({
      configStore: createMockConfigStore(),
      logger: createMockLogger(),
    });

    await pool.release("unknown");
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("releaseAll closes all sessions", async () => {
    const pool = new BrowserSessionPool({
      configStore: createMockConfigStore(),
      logger: createMockLogger(),
    });

    await pool.acquire("conv-1");
    await pool.acquire("conv-2");
    await pool.acquire("conv-3");
    expect(pool.activeSessions).toBe(3);

    await pool.releaseAll();
    expect(pool.activeSessions).toBe(0);
    expect(closeMock).toHaveBeenCalledTimes(3);
  });

  it("evicts oldest session when maxSessions is reached", async () => {
    const pool = new BrowserSessionPool({
      configStore: createMockConfigStore({ maxSessions: 2 }),
      logger: createMockLogger(),
    });

    await pool.acquire("conv-1");
    await new Promise((r) => setTimeout(r, 10));
    await pool.acquire("conv-2");
    expect(pool.activeSessions).toBe(2);

    await pool.acquire("conv-3");
    expect(pool.activeSessions).toBe(2);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("calls onNewSession when a new browser is created", async () => {
    const sessions: string[] = [];
    const pool = new BrowserSessionPool({
      configStore: createMockConfigStore(),
      logger: createMockLogger(),
      onNewSession: (convId) => sessions.push(convId),
    });

    await pool.acquire("conv-1");
    await pool.acquire("conv-1");
    await pool.acquire("conv-2");

    expect(sessions).toEqual(["conv-1", "conv-2"]);
  });
});
