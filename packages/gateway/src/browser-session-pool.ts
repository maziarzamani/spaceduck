import { BrowserTool } from "@spaceduck/tool-browser";
import type { ScreencastFrame } from "@spaceduck/tool-browser";
import type { Logger } from "@spaceduck/core";
import type { ConfigStore } from "./config";

interface SessionEntry {
  browser: BrowserTool;
  lastAccessMs: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export interface BrowserSessionPoolOptions {
  configStore: ConfigStore;
  logger: Logger;
  onNewSession?: (conversationId: string, browser: BrowserTool) => void;
}

/**
 * Manages per-conversation BrowserTool instances with configurable idle timeout
 * and optional max-session eviction. Reads `tools.browser.sessionIdleTimeoutMs`
 * and `tools.browser.maxSessions` from configStore on each acquire().
 */
export class BrowserSessionPool {
  private sessions = new Map<string, SessionEntry>();
  private readonly configStore: ConfigStore;
  private readonly logger: Logger;
  private readonly onNewSession?: (conversationId: string, browser: BrowserTool) => void;

  constructor(opts: BrowserSessionPoolOptions) {
    this.configStore = opts.configStore;
    this.logger = opts.logger.child({ component: "BrowserSessionPool" });
    this.onNewSession = opts.onNewSession;
  }

  get activeSessions(): number {
    return this.sessions.size;
  }

  async acquire(conversationId: string): Promise<BrowserTool> {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      existing.lastAccessMs = Date.now();
      this.resetIdleTimer(conversationId, existing);
      return existing.browser;
    }

    await this.evictIfNeeded();

    const browser = new BrowserTool({ headless: true });
    await browser.launch();
    this.logger.info("Browser session launched", { conversationId, activeSessions: this.sessions.size + 1 });

    const entry: SessionEntry = {
      browser,
      lastAccessMs: Date.now(),
      idleTimer: null,
    };
    this.sessions.set(conversationId, entry);
    this.resetIdleTimer(conversationId, entry);

    this.onNewSession?.(conversationId, browser);

    return browser;
  }

  async release(conversationId: string): Promise<void> {
    const entry = this.sessions.get(conversationId);
    if (!entry) return;

    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    this.sessions.delete(conversationId);

    try {
      await entry.browser.close();
      this.logger.info("Browser session closed", { conversationId, activeSessions: this.sessions.size });
    } catch (err) {
      this.logger.warn("Failed to close browser session", { conversationId, error: String(err) });
    }
  }

  async releaseAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(ids.map((id) => this.release(id)));
  }

  private getIdleTimeoutMs(): number {
    try {
      return this.configStore.current.tools.browser.sessionIdleTimeoutMs;
    } catch {
      return 600_000;
    }
  }

  private getMaxSessions(): number | null {
    try {
      return this.configStore.current.tools.browser.maxSessions;
    } catch {
      return null;
    }
  }

  private resetIdleTimer(conversationId: string, entry: SessionEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);

    const timeoutMs = this.getIdleTimeoutMs();
    if (timeoutMs <= 0) {
      entry.idleTimer = null;
      return;
    }

    entry.idleTimer = setTimeout(() => {
      this.logger.info("Browser session idle timeout", { conversationId, timeoutMs });
      this.release(conversationId).catch((err) => {
        this.logger.warn("Idle release failed", { conversationId, error: String(err) });
      });
    }, timeoutMs);
  }

  private async evictIfNeeded(): Promise<void> {
    const maxSessions = this.getMaxSessions();
    if (maxSessions === null || this.sessions.size < maxSessions) return;

    let oldestId: string | null = null;
    let oldestAccess = Infinity;
    for (const [id, entry] of this.sessions) {
      if (entry.lastAccessMs < oldestAccess) {
        oldestAccess = entry.lastAccessMs;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.logger.info("Evicting oldest browser session", { conversationId: oldestId, maxSessions });
      await this.release(oldestId);
    }
  }
}
