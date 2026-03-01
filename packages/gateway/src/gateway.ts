// Gateway: composition root that wires all dependencies and manages lifecycle

import { Database } from "bun:sqlite";
import {
  type SpaceduckConfig,
  type Logger,
  type Provider,
  type ProviderChunk,
  type ConversationStore,
  type MemoryStore,
  type SessionManager,
  type Lifecycle,
  type LifecycleStatus,
  type EmbeddingProvider,
  type Channel,
  type Message,
  ConsoleLogger,
  SimpleEventBus,
  DefaultContextBuilder,
  AgentLoop,
  MemoryExtractor,
  loadConfig,
  ToolRegistry,
  GATEWAY_VERSION,
  API_VERSION,
  GIT_SHA,
} from "@spaceduck/core";
import type { EventBus } from "@spaceduck/core";
import {
  SchemaManager,
  ensureCustomSQLite,
  SqliteConversationStore,
  SqliteMemoryStore,
  SqliteSessionManager,
  reconcileVecFacts,
  reconcileVecMemories,
} from "@spaceduck/memory-sqlite";
import { RunLock } from "./run-lock";
import { createWsHandler, type WsConnectionData } from "./ws-handler";
import { buildToolRegistry } from "./tool-registrations";
import { createBrowserFrameTarget } from "./browser-frame-target";
import { BrowserSessionPool } from "./browser-session-pool";
import { buildChannels } from "./channel-registrations";
import { ToolStatusService } from "./tools/tools-status";
import type { ToolName } from "./tools/tools-status";
import { createEmbeddingProvider } from "./embedding-factory";
import { AttachmentStore } from "./attachment-store";
import { SwappableProvider } from "./swappable-provider";
import { SwappableEmbeddingProvider } from "./swappable-embedding-provider";
import {
  SqliteTaskStore,
  TaskScheduler,
  TaskQueue,
  GlobalBudgetGuard,
  createTaskRunner,
} from "@spaceduck/scheduler";
import type { TaskRunResult } from "@spaceduck/scheduler";
import { handleSchedulerRoute } from "./scheduler-routes";
import { WhisperStt, SttError } from "@spaceduck/stt-whisper";
import { AwsTranscribeStt, SttError as AwsSttError } from "@spaceduck/stt-aws-transcribe";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  ensureGatewaySettings,
  getGatewayInfo,
  createPairingSession,
  getActivePairingSession,
  getActivePairingCode,
  confirmPairing,
  requireAuth,
  extractToken,
  verifyToken,
  listTokens,
  revokeToken,
  type GatewayInfo,
} from "./auth";
import {
  ConfigStore,
  getCapabilities,
  getConfiguredStatus,
  getSystemProfile,
} from "./config";
import type { ConfigPatchOp, SpaceduckProductConfig } from "@spaceduck/config";
import { isSecretPath, DEFAULT_SYSTEM_PROMPT } from "@spaceduck/config";

const MODEL_CATALOG: Record<string, { id: string; name: string; context?: string }[]> = {
  bedrock: [
    { id: "us.amazon.nova-2-lite-v1:0", name: "Amazon Nova 2 Lite", context: "300K" },
    { id: "us.amazon.nova-2-pro-v1:0", name: "Amazon Nova 2 Pro", context: "300K" },
    { id: "us.anthropic.claude-sonnet-4-20250514-v1:0", name: "Claude Sonnet 4", context: "200K" },
    { id: "us.anthropic.claude-3-5-haiku-20241022-v1:0", name: "Claude 3.5 Haiku", context: "200K" },
    { id: "us.meta.llama4-scout-17b-16e-instruct-v1:0", name: "Llama 4 Scout 17B", context: "512K" },
    { id: "us.meta.llama4-maverick-17b-16e-instruct-v1:0", name: "Llama 4 Maverick 17B", context: "512K" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", context: "1M" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", context: "1M" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", context: "1M" },
  ],
  openrouter: [
    { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
    { id: "openai/gpt-4.1", name: "GPT-4.1" },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
    { id: "meta-llama/llama-4-scout", name: "Llama 4 Scout" },
  ],
  lmstudio: [],
  llamacpp: [],
};

export interface GatewayDeps {
  readonly config: SpaceduckConfig;
  readonly logger: Logger;
  readonly eventBus: EventBus;
  readonly provider: Provider;
  readonly conversationStore: ConversationStore;
  readonly memoryStore?: MemoryStore;
  readonly sessionManager: SessionManager;
  readonly agent: AgentLoop;
  readonly runLock: RunLock;
  readonly embeddingProvider?: EmbeddingProvider;
  readonly channels?: Channel[];
  readonly attachmentStore: AttachmentStore;
  readonly configStore?: ConfigStore;
  readonly swappableProvider?: SwappableProvider;
  readonly swappableEmbeddingProvider?: SwappableEmbeddingProvider;
  readonly contextBuilder?: DefaultContextBuilder;
  readonly browserPool?: BrowserSessionPool;
  readonly conversationIdRef?: { current: string };
  readonly browserFrame?: ReturnType<typeof createBrowserFrameTarget>;
}

export class Gateway implements Lifecycle {
  private _status: LifecycleStatus = "stopped";
  private server: ReturnType<typeof Bun.serve> | null = null;
  private db: Database | null = null;
  private authRequired: boolean;
  private gatewayInfo: GatewayInfo | null = null;
  private whisperStt: WhisperStt | null = null;
  private awsTranscribeStt: AwsTranscribeStt | null = null;
  private activeSttBackend: "whisper" | "aws-transcribe" = "whisper";
  private stt: {
    available: boolean;
    reason?: string;
    backend: string;
    model: string;
    language: string;
    maxSeconds: number;
    maxBytes: number;
    timeoutMs: number;
  } = {
    available: false,
    backend: "whisper",
    model: "small",
    language: Bun.env.SPACEDUCK_STT_LANGUAGE ?? "",
    maxSeconds: 120,
    maxBytes: 15 * 1024 * 1024,
    timeoutMs: 300_000,
  };

  readonly deps: GatewayDeps;
  toolStatusService: ToolStatusService | null = null;
  private channels: Channel[] = [];
  private readonly browserFrame: ReturnType<typeof createBrowserFrameTarget>;
  private readonly browserPool: BrowserSessionPool | undefined;
  private readonly conversationIdRef: { current: string };
  private taskStore: SqliteTaskStore | null = null;
  private taskScheduler: TaskScheduler | null = null;
  private taskQueue: TaskQueue | null = null;

  constructor(deps: GatewayDeps, db?: Database) {
    this.deps = deps;
    this.db = db ?? null;
    this.authRequired = (Bun.env.SPACEDUCK_REQUIRE_AUTH ?? "1") !== "0";
    this.channels = deps.channels ?? [];
    this.browserPool = deps.browserPool;
    this.conversationIdRef = deps.conversationIdRef ?? { current: "" };
    this.browserFrame = deps.browserFrame ?? createBrowserFrameTarget();
  }

  get status(): LifecycleStatus {
    return this._status;
  }

  get port(): number {
    return this.server?.port ?? 0;
  }

  async start(): Promise<void> {
    if (this._status === "running" || this._status === "starting") return;
    this._status = "starting";

    const { config, logger } = this.deps;

    if (this.db) {
      this.gatewayInfo = ensureGatewaySettings(this.db);
    }

    if (!this.authRequired) {
      logger.warn("⚠️  AUTH DISABLED — all endpoints are publicly accessible. Set SPACEDUCK_REQUIRE_AUTH=1 for production.");
    }

    const wsHandler = createWsHandler({
      logger,
      agent: this.deps.agent,
      conversationStore: this.deps.conversationStore,
      sessionManager: this.deps.sessionManager,
      runLock: this.deps.runLock,
      browserFrameTarget: this.browserFrame.target,
      browserPool: this.browserPool,
      conversationIdRef: this.conversationIdRef,
    });

    this.server = Bun.serve<WsConnectionData>({
      port: config.port,
      development: false,
      fetch: async (req, server) => {
        let resp: Response | undefined;
        try {
          resp = await this.handleRequest(req, server);
        } catch (err) {
          logger.error("handleRequest threw", { url: req.url, error: String(err) });
          return Response.json({ error: "Internal Server Error" }, { status: 500 });
        }
        if (resp) {
          const cors = this.corsHeaders(req);
          for (const [k, v] of Object.entries(cors)) resp.headers.set(k, v);
        }
        return resp;
      },
      websocket: {
        message: wsHandler.message,
        open: wsHandler.open,
        close: wsHandler.close,
      },
    });

    this._status = "running";

    // Start external channels (WhatsApp, etc.)
    await this.startChannels();

    // Initialize scheduler if enabled
    await this.initScheduler();

    const productCfg = this.deps.configStore?.current;
    const embeddingRef =
      this.deps.swappableEmbeddingProvider ?? this.deps.embeddingProvider;
    logger.info("Gateway started", {
      port: config.port,
      provider: this.deps.provider.name,
      model: productCfg?.ai.model ?? config.provider.model,
      memory: config.memory.backend,
      embedding: embeddingRef?.name ?? "disabled",
      scheduler: productCfg?.scheduler?.enabled ? "enabled" : "disabled",
    });
  }

  async stop(): Promise<void> {
    if (this._status === "stopped" || this._status === "stopping") return;
    this._status = "stopping";

    // Stop scheduler
    if (this.taskScheduler) {
      await this.taskScheduler.stop();
      this.taskScheduler = null;
    }

    // Stop external channels
    await this.stopChannels();

    // Close all browser sessions
    if (this.browserPool) await this.browserPool.releaseAll();

    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }

    // Stop attachment store sweeper
    this.deps.attachmentStore.stop();

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.deps.logger.info("Gateway stopped");
    this._status = "stopped";
  }

  private async startChannel(channel: Channel): Promise<void> {
    channel.onMessage(async (msg) => {
      await this.handleChannelMessage(channel, msg);
    });
    await channel.start();
    this.deps.logger.info("Channel started", { channel: channel.name });
  }

  private async stopChannel(channel: Channel): Promise<void> {
    await channel.stop();
    this.deps.logger.info("Channel stopped", { channel: channel.name });
  }

  private async initScheduler(): Promise<void> {
    const productConfig = this.deps.configStore?.current;
    if (!productConfig?.scheduler?.enabled || !this.db) return;

    const { logger, eventBus, agent, conversationStore, memoryStore, runLock } = this.deps;
    const schedCfg = productConfig.scheduler;
    const log = logger.child({ component: "Scheduler" });

    try {
      this.taskStore = new SqliteTaskStore(this.db, log);
      await this.taskStore.migrate();

      const defaultBudget = {
        maxTokens: schedCfg.defaultBudget.maxTokens,
        maxCostUsd: schedCfg.defaultBudget.maxCostUsd,
        maxWallClockMs: schedCfg.defaultBudget.maxWallClockMs,
        maxToolCalls: schedCfg.defaultBudget.maxToolCalls,
        maxMemoryWrites: schedCfg.defaultBudget.maxMemoryWrites,
      };

      const runner = createTaskRunner({
        agent,
        conversationStore,
        memoryStore,
        eventBus,
        logger: log,
        defaultBudget,
      });

      const globalBudget = new GlobalBudgetGuard(
        this.taskStore,
        {
          dailyLimitUsd: schedCfg.globalBudget.dailyLimitUsd,
          monthlyLimitUsd: schedCfg.globalBudget.monthlyLimitUsd,
          alertThresholds: schedCfg.globalBudget.alertThresholds,
          onLimitReached: schedCfg.globalBudget.onLimitReached,
        },
        eventBus,
        { pause: () => this.taskScheduler?.pause(), resume: () => this.taskScheduler?.resume(), get isPaused() { return false; } },
        log,
      );

      this.taskQueue = new TaskQueue(
        this.taskStore,
        runLock,
        runner,
        globalBudget,
        eventBus,
        log,
        {
          maxConcurrent: schedCfg.maxConcurrentTasks,
          maxRetries: schedCfg.retry.maxAttempts,
          backoffBaseMs: schedCfg.retry.backoffBaseMs,
          backoffMaxMs: schedCfg.retry.backoffMaxMs,
        },
      );

      this.taskScheduler = new TaskScheduler(
        this.taskStore,
        this.taskQueue,
        eventBus,
        log,
        { heartbeatIntervalMs: schedCfg.heartbeatIntervalMs },
      );

      await this.taskScheduler.start();
      log.info("Scheduler initialized and started");
    } catch (e) {
      log.error("Failed to initialize scheduler", { error: String(e) });
    }
  }

  private async startChannels(): Promise<void> {
    for (const channel of this.channels) {
      try {
        await this.startChannel(channel);
      } catch (err) {
        this.deps.logger.error("Failed to start channel", {
          channel: channel.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async stopChannels(): Promise<void> {
    for (const channel of this.channels) {
      try {
        await this.stopChannel(channel);
      } catch {
        // Best-effort
      }
    }
  }

  private rebuildAndSwapTools(reason: string, changedPaths?: string[]): SwapResult {
    const startMs = Date.now();
    const configStore = this.deps.configStore;
    const prevSize = this.deps.agent.toolRegistry?.size ?? 0;
    try {
      const next = buildToolRegistry(
        this.deps.logger, this.deps.attachmentStore, configStore,
        this.browserFrame.onFrame, this.browserPool,
        () => this.conversationIdRef.current,
      );
      this.deps.agent.setToolRegistry(next);
      this.deps.logger.info("Tool registry hot-swapped", {
        reason, changedPaths,
        prevTools: prevSize, newTools: next.size,
        elapsedMs: Date.now() - startMs,
      });
      return { ok: true };
    } catch (err) {
      this.deps.logger.error("Tool registry hot-swap failed, keeping previous", {
        reason, changedPaths,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        code: "TOOL_SWAP_FAILED",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async rebuildAndSwapChannels(reason: string, changedPaths?: string[]): Promise<SwapResult> {
    const startMs = Date.now();
    const configStore = this.deps.configStore;
    if (!configStore) {
      return { ok: false, code: "CHANNEL_SWAP_FAILED", message: "No config store available" };
    }
    const oldChannels = this.channels;

    const newChannels = buildChannels(configStore.current, this.deps.logger);

    // Phase 2: stop old (required for exclusive resources like WhatsApp sessions)
    const stoppedOld: Channel[] = [];
    for (const ch of oldChannels) {
      try {
        await this.stopChannel(ch);
        stoppedOld.push(ch);
      } catch (err) {
        this.deps.logger.error("Channel stop failed, aborting swap", {
          reason, channel: ch.name, error: err instanceof Error ? err.message : String(err),
        });
        for (const stopped of stoppedOld) {
          try { await this.startChannel(stopped); } catch {}
        }
        return {
          ok: false,
          code: "CHANNEL_SWAP_FAILED",
          message: `Failed to stop ${ch.name}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // Phase 3: start new
    try {
      for (const ch of newChannels) { await this.startChannel(ch); }
    } catch (err) {
      let rollbackFailed = 0;
      for (const ch of oldChannels) {
        try { await this.startChannel(ch); }
        catch { rollbackFailed++; }
      }
      this.channels = oldChannels;
      this.deps.logger.error("Channel swap failed, rolled back", {
        reason, changedPaths,
        rollbackAttempted: true,
        rollbackSucceeded: rollbackFailed === 0,
        rollbackFailedChannels: rollbackFailed,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        code: "CHANNEL_SWAP_FAILED",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // Phase 4: swap refs (old channels already stopped in Phase 2)
    this.channels = newChannels;
    this.deps.logger.info("Channels hot-swapped", {
      reason, changedPaths,
      prevChannels: oldChannels.length, newChannels: newChannels.length,
      elapsedMs: Date.now() - startMs,
    });
    return { ok: true };
  }

  private async rebuildAndSwapStt(reason: string, changedPaths?: string[]): Promise<SwapResult> {
    const startMs = Date.now();
    const prevBackend = this.activeSttBackend;
    try {
      await this.initStt();
      this.deps.logger.info("STT hot-swapped", {
        reason, changedPaths,
        prevBackend, newBackend: this.activeSttBackend,
        elapsedMs: Date.now() - startMs,
      });
      return { ok: true };
    } catch (err) {
      this.deps.logger.error("STT hot-swap failed, keeping previous", {
        reason, changedPaths,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        code: "STT_SWAP_FAILED",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async handleChannelMessage(channel: Channel, msg: import("@spaceduck/core").ChannelMessage): Promise<void> {
    const { agent, conversationStore, sessionManager, runLock, logger } = this.deps;
    const log = logger.child({ component: channel.name });

    // Resolve session -> conversation
    const session = await sessionManager.resolve(msg.channelId, msg.senderId);
    const conversationId = session.conversationId;

    // Ensure conversation exists
    const existing = await conversationStore.load(conversationId);
    if (!existing.ok) {
      await channel.sendError(msg.senderId, "MEMORY_ERROR", "Failed to load conversation", {
        conversationId,
        requestId: msg.requestId,
      });
      return;
    }
    if (!existing.value) {
      await conversationStore.create(conversationId);
    }

    // Acquire run lock
    const release = await runLock.acquire(conversationId);

    try {
      const userMessage: Message = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
        role: "user",
        content: msg.content,
        timestamp: Date.now(),
        requestId: msg.requestId,
      };

      const response = { conversationId, requestId: msg.requestId };

      // Stream agent chunks — deltas are buffered by the channel,
      // then flushed as a single message on sendDone.
      let responseMessageId = "";
      for await (const chunk of agent.run(conversationId, userMessage)) {
        if (chunk.type === "text") {
          await channel.sendDelta(msg.senderId, chunk.text, response);
        }
      }

      // Get the persisted assistant message ID
      const msgs = await conversationStore.loadMessages(conversationId);
      if (msgs.ok && msgs.value.length > 0) {
        const lastMsg = msgs.value[msgs.value.length - 1];
        if (lastMsg.role === "assistant") {
          responseMessageId = lastMsg.id;
        }
      }

      await channel.sendDone(msg.senderId, responseMessageId, response);
    } catch (err) {
      log.error("Agent run failed", {
        senderId: msg.senderId,
        error: err instanceof Error ? err.message : String(err),
      });
      await channel.sendError(msg.senderId, "AGENT_ERROR", "Something went wrong", {
        conversationId,
        requestId: msg.requestId,
      });
    } finally {
      release();
    }
  }

  private corsHeaders(req: Request): Record<string, string> {
    return {
      "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, If-Match, X-STT-Language",
      "Access-Control-Expose-Headers": "ETag",
      "Access-Control-Max-Age": "86400",
    };
  }

  private async handleRequest(req: Request, server: Bun.Server<WsConnectionData>): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: this.corsHeaders(req) });
    }

    // ── Unauthenticated routes ───────────────────────────────────────

    // WebSocket upgrade (auth checked via token query param)
    if (url.pathname === "/ws") {
      if (this.db && this.authRequired) {
        const raw = extractToken(req);
        if (!raw || !verifyToken(this.db, raw)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
      }
      const senderId = url.searchParams.get("senderId") || `anon-${Date.now().toString(36)}`;
      const upgraded = server.upgrade(req, {
        data: {
          senderId,
          channelId: "web",
          connectedAt: Date.now(),
        },
      });
      if (upgraded) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Health endpoint
    if (req.method === "GET" && url.pathname === "/api/health") {
      const embedRef =
        this.deps.swappableEmbeddingProvider ?? this.deps.embeddingProvider;
      return Response.json({
        status: "ok",
        version: GATEWAY_VERSION,
        apiVersion: API_VERSION,
        commit: GIT_SHA,
        uptime: process.uptime(),
        provider: this.deps.provider.name,
        model: this.deps.configStore?.current?.ai.model ?? this.deps.config.provider.model,
        memory: this.deps.config.memory.backend,
        embedding: embedRef?.name ?? "disabled",
      });
    }

    // STT status (unauthenticated — no secrets exposed)
    if (req.method === "GET" && url.pathname === "/api/stt/status") {
      const productConfig = this.deps.configStore?.current;
      const dictation = productConfig?.stt?.dictation;
      return Response.json(this.stt.available
        ? {
            available: true,
            backend: this.stt.backend,
            model: this.stt.model,
            language: this.stt.language || undefined,
            maxSeconds: this.stt.maxSeconds,
            maxBytes: this.stt.maxBytes,
            timeoutMs: this.stt.timeoutMs,
            dictation: dictation ? {
              enabled: dictation.enabled,
              hotkey: dictation.hotkey,
            } : undefined,
          }
        : {
            available: false,
            reason: this.stt.reason,
          },
      );
    }

    // Capabilities (unauthenticated — binary/env availability only)
    if (req.method === "GET" && url.pathname === "/api/capabilities") {
      const capabilities = await getCapabilities();
      return Response.json(capabilities);
    }

    // System profile (unauthenticated — safe hardware info for setup)
    if (req.method === "GET" && url.pathname === "/api/system/profile") {
      return Response.json(getSystemProfile());
    }

    // Public gateway info (no auth — used by onboarding to validate URL)
    if (req.method === "GET" && url.pathname === "/api/gateway/public-info") {
      const info = this.gatewayInfo ?? { gatewayId: "unknown", gatewayName: "unknown" };
      return Response.json({
        gatewayId: info.gatewayId,
        gatewayName: info.gatewayName,
        version: "0.1.0",
        requiresAuth: this.authRequired,
        wsPath: "/ws",
      });
    }

    // Pairing start
    if (req.method === "POST" && url.pathname === "/api/pair/start") {
      if (!this.db) return Response.json({ error: "No database" }, { status: 500 });
      const existing = getActivePairingSession(this.db);
      const session = existing ?? createPairingSession(this.db);
      const logCode = (Bun.env.SPACEDUCK_PAIRING_LOG_CODE ?? "0") === "1";
      if (logCode && !existing) {
        this.deps.logger.info(`PAIR CODE: ${session.code}`);
      }
      return Response.json({
        pairingId: session.pairingId,
        codeHint: `${session.code.length}-digit code`,
      });
    }

    // Pairing confirm
    if (req.method === "POST" && url.pathname === "/api/pair/confirm") {
      if (!this.db) return Response.json({ error: "No database" }, { status: 500 });
      try {
        const body = await req.json() as { pairingId?: string; code?: string; deviceName?: string };
        if (!body.pairingId || !body.code) {
          return Response.json({ error: "Missing pairingId or code" }, { status: 400 });
        }
        const result = confirmPairing(this.db, body.pairingId, body.code, body.deviceName);
        if (!result.ok) {
          const status = result.error === "rate_limited" ? 429
            : result.error === "expired" ? 410
            : result.error === "not_found" ? 404
            : 401;
          return Response.json({ error: result.error }, { status });
        }
        return Response.json(result.result);
      } catch {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }
    }

    // Pairing page (simple HTML)
    if (req.method === "GET" && url.pathname === "/pair") {
      return this.servePairingPage();
    }

    // ── Authenticated routes ─────────────────────────────────────────

    if (this.db) {
      const token = requireAuth(req, this.db, this.authRequired);

      // Gateway info (authenticated)
      if (req.method === "GET" && url.pathname === "/api/gateway/info") {
        if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const info = this.gatewayInfo ?? { gatewayId: "unknown", gatewayName: "unknown" };
        return Response.json({
          gatewayId: info.gatewayId,
          gatewayName: info.gatewayName,
          version: "0.1.0",
          wsPath: "/ws",
          httpBase: "/",
        });
      }

      // List tokens (devices)
      if (req.method === "GET" && url.pathname === "/api/tokens") {
        if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const tokens = listTokens(this.db).map((t) => ({
          id: t.id,
          deviceName: t.deviceName,
          createdAt: t.createdAt,
          lastUsedAt: t.lastUsedAt,
          isCurrent: t.tokenHash === token.tokenHash,
        }));
        return Response.json({ tokens });
      }

      // Revoke token
      if (req.method === "POST" && url.pathname === "/api/tokens/revoke") {
        if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
        try {
          const body = await req.json() as { tokenId?: string };
          const targetId = body.tokenId ?? token.id;
          const revoked = revokeToken(this.db, targetId);
          return Response.json({ revoked });
        } catch {
          return Response.json({ error: "Invalid request body" }, { status: 400 });
        }
      }

      // Conversations list
      if (req.method === "GET" && url.pathname === "/api/conversations") {
        if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const result = await this.deps.conversationStore.list();
        if (!result.ok) {
          return Response.json({ error: result.error.message }, { status: 500 });
        }
        return Response.json({ conversations: result.value });
      }

      // File upload
      if (req.method === "POST" && url.pathname === "/api/upload") {
        if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
        return this.handleUpload(req);
      }

      // STT transcribe
      if (req.method === "POST" && url.pathname === "/api/stt/transcribe") {
        if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
        return this.handleTranscribe(req);
      }

      // STT backend test
      if (req.method === "GET" && url.pathname === "/api/stt/test") {
        if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
        return this.handleSttTest();
      }

      // ── Config API routes ──────────────────────────────────────

      const configStore = this.deps.configStore;
      const swappable = this.deps.swappableProvider;
      const ctxBuilder = this.deps.contextBuilder;
      if (configStore) {
        // GET /api/config/models (authenticated) — model catalog for current provider
        if (req.method === "GET" && url.pathname === "/api/config/models") {
          if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
          const config = configStore.current;
          const provider = config.ai.provider;

          if (provider === "bedrock") {
            try {
              const models = await fetchBedrockModels(config);
              return Response.json({ provider, models });
            } catch {
              const models = MODEL_CATALOG.bedrock ?? [];
              return Response.json({ provider, models, fallback: true });
            }
          }

          const models = MODEL_CATALOG[provider] ?? [];
          return Response.json({ provider, models });
        }

        // GET /api/config/provider-status (authenticated) — lightweight provider connectivity test
        if (req.method === "GET" && url.pathname === "/api/config/provider-status") {
          if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
          const swapRef = this.deps.swappableProvider;
          if (!swapRef) {
            return Response.json({ ok: false, error: "No provider configured" });
          }
          const currentProvider = swapRef.current;
          const config = configStore.current;
          try {
            const chunks: string[] = [];
            for await (const chunk of currentProvider.chat(
              [{ id: "ping", role: "user", content: "Say OK", timestamp: Date.now(), source: "system" as const }],
              { signal: AbortSignal.timeout(10_000) },
            )) {
              if (chunk.type === "text") chunks.push(chunk.text);
              if (chunks.join("").length > 20) break;
            }
            return Response.json({
              ok: true,
              provider: config.ai.provider,
              model: config.ai.model,
            });
          } catch (err) {
            return Response.json({
              ok: false,
              provider: config.ai.provider,
              model: config.ai.model,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // POST /api/config/provider-test (authenticated) — test provider connectivity without writing config
        if (req.method === "POST" && url.pathname === "/api/config/provider-test") {
          if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
          try {
            const body = (await req.json()) as Record<string, unknown>;
            const parsed = parseProviderTestRequest(body);
            if (!parsed.ok) {
              return Response.json(
                { ok: false, error: { code: "INVALID_REQUEST", message: parsed.error, retryable: false } },
                { status: 400 },
              );
            }
            const { provider, baseUrl, model, region, secretSlot } = parsed.value;

            let resolvedSecret: string | null = null;
            if (secretSlot) {
              const cfg = configStore.current;
              resolvedSecret = resolveSecretFromConfig(cfg, secretSlot);
              if (!resolvedSecret) {
                return Response.json({
                  ok: false,
                  error: { code: "NO_SECRET", message: "API key not set. Save your key first, then test.", retryable: false },
                });
              }
            }

            const result = await probeProvider({
              provider,
              baseUrl: baseUrl ?? undefined,
              model: model ?? undefined,
              region: region ?? undefined,
              secret: resolvedSecret,
              logger: this.deps.logger,
            });
            return Response.json(result);
          } catch (err) {
            return Response.json({
              ok: false,
              error: mapProviderTestError(err),
            });
          }
        }

        // GET /api/config/embedding-status (authenticated) — lightweight embedding connectivity test
        if (req.method === "GET" && url.pathname === "/api/config/embedding-status") {
          if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
          const ep = this.deps.swappableEmbeddingProvider ?? this.deps.embeddingProvider;
          if (!ep || (ep instanceof SwappableEmbeddingProvider && !ep.isConfigured)) {
            return Response.json({ ok: false, error: "Embeddings disabled" });
          }
          try {
            const timeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Embedding test timed out")), 10_000),
            );
            await Promise.race([ep.embed("ping", { purpose: "index" }), timeout]);
            return Response.json({ ok: true, provider: ep.name, dimensions: ep.dimensions });
          } catch (err) {
            return Response.json({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // GET /api/config (authenticated)
        if (req.method === "GET" && url.pathname === "/api/config") {
          if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
          const { config, rev, secrets } = configStore.getRedacted();
          const envCaps = await getCapabilities();
          const configured = getConfiguredStatus(configStore.current);
          return Response.json(
            { config, rev, secrets, capabilities: { ...envCaps, configured } },
            { headers: { ETag: rev } },
          );
        }

        // PATCH /api/config (authenticated, requires If-Match)
        if (req.method === "PATCH" && url.pathname === "/api/config") {
          if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
          const ifMatch = req.headers.get("If-Match");
          if (!ifMatch) {
            return Response.json(
              { error: "MISSING_IF_MATCH", message: "If-Match header required" },
              { status: 428 },
            );
          }
          try {
            const ops = (await req.json()) as ConfigPatchOp[];
            if (!Array.isArray(ops)) {
              return Response.json(
                { error: "INVALID_BODY", message: "Expected JSON array of patch ops" },
                { status: 400 },
              );
            }
            return await withConfigLock(async () => {
              const result = await configStore.patch(ops, ifMatch);
              if (!result.ok) {
                if (result.error === "CONFLICT") {
                  return Response.json(
                    { error: "CONFLICT", rev: result.rev },
                    { status: 409, headers: { ETag: result.rev } },
                  );
                }
                if (result.error === "VALIDATION") {
                  return Response.json(
                    { error: "VALIDATION", issues: result.issues },
                    { status: 400 },
                  );
                }
                return Response.json(
                  { error: "PATCH_ERROR", message: result.message },
                  { status: 400 },
                );
              }

              // Hot-swap provider if AI config changed
              const warnings: Array<{ code: string; message: string }> = [];
              const changedPaths = new Set(ops.map((op) => op.path));
              const needsRebuild = [...PROVIDER_REBUILD_PATHS].some((p) =>
                changedPaths.has(p),
              );
              if (needsRebuild && swappable) {
                try {
                  const next = buildProvider(configStore.current, this.deps.logger);
                  swappable.swap(next);
                  this.deps.logger.info("Provider hot-swapped", {
                    provider: configStore.current.ai.provider,
                    model: configStore.current.ai.model,
                  });
                } catch (err) {
                  this.deps.logger.error("Provider hot-swap failed", {
                    error: err instanceof Error ? err.message : String(err),
                  });
                  warnings.push({
                    code: "PROVIDER_SWAP_FAILED",
                    message: err instanceof Error ? err.message : String(err),
                  });
                }
              }

              // Hot-swap system prompt
              if (changedPaths.has("/ai/systemPrompt") && ctxBuilder) {
                ctxBuilder.setSystemPrompt(
                  configStore.current.ai.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
                );
              }

              // Hot-swap embedding provider if embedding config changed
              const swappableEmbed = this.deps.swappableEmbeddingProvider;
              const needsEmbedRebuild = [...EMBEDDING_REBUILD_PATHS].some((p) =>
                changedPaths.has(p),
              );
              if (needsEmbedRebuild && swappableEmbed) {
                try {
                  const next = createEmbeddingProvider(
                    this.deps.config,
                    this.deps.logger,
                    configStore.current,
                  );
                  swappableEmbed.swap(next);
                  if (this.db) {
                    reconcileVecFacts(
                      this.db,
                      next,
                      this.deps.logger,
                      this.deps.config.memory.connectionString,
                    );
                    reconcileVecMemories(
                      this.db,
                      next,
                      this.deps.logger,
                    );
                  }
                  this.deps.logger.info("Embedding provider hot-swapped", {
                    provider: next?.name ?? "disabled",
                  });
                } catch (err) {
                  this.deps.logger.warn("Embedding hot-swap failed, disabling embeddings", {
                    error: err instanceof Error ? err.message : String(err),
                  });
                  swappableEmbed.swap(undefined);
                  warnings.push({
                    code: "EMBEDDING_SWAP_FAILED",
                    message: err instanceof Error ? err.message : String(err),
                  });
                }
              }

              // Hot-swap tool registry if tool config changed
              if (shouldRebuildTools(changedPaths)) {
                const r = this.rebuildAndSwapTools("config_patch", [...changedPaths]);
                if (!r.ok) warnings.push({ code: r.code, message: r.message });
              }

              // Hot-swap channels if channel config changed
              if (shouldRebuildChannels(changedPaths)) {
                const r = await this.rebuildAndSwapChannels("config_patch", [...changedPaths]);
                if (!r.ok) warnings.push({ code: r.code, message: r.message });
              }

              // Hot-swap STT backend if STT config changed
              if (shouldRebuildStt(changedPaths)) {
                const r = await this.rebuildAndSwapStt("config_patch", [...changedPaths]);
                if (!r.ok) warnings.push({ code: r.code, message: r.message });
              }

              const response: Record<string, unknown> = {
                config: result.config,
                rev: result.rev,
              };
              if (result.needsRestart) {
                response.needsRestart = result.needsRestart;
              }
              if (warnings.length > 0) {
                response.warnings = warnings;
              }
              return Response.json(response, {
                headers: { ETag: result.rev },
              });
            });
          } catch {
            return Response.json(
              { error: "INVALID_BODY", message: "Invalid JSON body" },
              { status: 400 },
            );
          }
        }

        // POST /api/config/secrets (authenticated)
        if (req.method === "POST" && url.pathname === "/api/config/secrets") {
          if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
          try {
            const body = (await req.json()) as {
              op?: string;
              path?: string;
              value?: string;
            };
            if (!body.op || !body.path) {
              return Response.json(
                { error: "INVALID_BODY", message: "Missing op or path" },
                { status: 400 },
              );
            }
            if (!isSecretPath(body.path)) {
              return Response.json(
                { error: "INVALID_PATH", message: `"${body.path}" is not a known secret path` },
                { status: 400 },
              );
            }
            return await withConfigLock(async () => {
              if (body.op === "set") {
                if (!body.value || typeof body.value !== "string") {
                  return Response.json(
                    { error: "INVALID_BODY", message: "Missing value for set op" },
                    { status: 400 },
                  );
                }
                await configStore.setSecret(body.path!, body.value);
              } else if (body.op === "unset") {
                await configStore.unsetSecret(body.path!);
              } else {
                return Response.json(
                  { error: "INVALID_OP", message: `Unknown op "${body.op}" — use "set" or "unset"` },
                  { status: 400 },
                );
              }

              // Hot-swap provider if an AI secret changed
              if (AI_SECRET_PATHS.has(body.path!) && swappable) {
                try {
                  const next = buildProvider(configStore.current, this.deps.logger);
                  swappable.swap(next);
                  this.deps.logger.info("Provider hot-swapped after secret change", {
                    path: body.path,
                    provider: configStore.current.ai.provider,
                  });
                } catch (err) {
                  this.deps.logger.warn("Provider hot-swap failed after secret change (will use previous provider)", {
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }

              // Hot-swap tool registry if a tool-affecting secret changed
              const secretWarnings: Array<{ code: string; message: string }> = [];
              if (shouldRebuildToolsForSecret(body.path!)) {
                const r = this.rebuildAndSwapTools("secret_update", [body.path!]);
                if (!r.ok) secretWarnings.push({ code: r.code, message: r.message });
              }

              return Response.json({
                ok: true,
                ...(secretWarnings.length > 0 ? { warnings: secretWarnings } : {}),
              });
            });
          } catch {
            return Response.json(
              { error: "INVALID_BODY", message: "Invalid JSON body" },
              { status: 400 },
            );
          }
        }
      }

      // GET /api/tools/status (authenticated) — cheap cached tool status
      if (req.method === "GET" && url.pathname === "/api/tools/status") {
        if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
        if (!this.toolStatusService) {
          return Response.json({ tools: [] });
        }
        return Response.json({ tools: this.toolStatusService.getStatus() });
      }

      // POST /api/tools/test (authenticated) — active probe
      if (req.method === "POST" && url.pathname === "/api/tools/test") {
        if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
        if (!this.toolStatusService) {
          return Response.json({ ok: false, message: "Tool status service not available" }, { status: 503 });
        }
        try {
          const body = (await req.json()) as { tool?: string };
          const tool = body.tool as ToolName | undefined;
          if (!tool || !["web_search", "web_answer", "marker_scan", "browser_navigate", "web_fetch"].includes(tool)) {
            return Response.json(
              { ok: false, message: "Invalid tool name. Expected: web_search, web_answer, marker_scan, browser_navigate, or web_fetch" },
              { status: 400 },
            );
          }
          const result = await this.toolStatusService.probe(tool);
          return Response.json({ tool, ...result });
        } catch {
          return Response.json(
            { ok: false, message: "Invalid request body" },
            { status: 400 },
          );
        }
      }
    }

    // ── Scheduler routes ────────────────────────────────────────────
    if (url.pathname.startsWith("/api/tasks") && this.taskStore && this.taskScheduler) {
      const token = this.db ? requireAuth(req, this.db, this.authRequired) : true;
      if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

      const schedulerResp = await handleSchedulerRoute(req, url, {
        store: this.taskStore,
        scheduler: this.taskScheduler,
        logger: this.deps.logger,
      });
      if (schedulerResp) return schedulerResp;
    }

    // 404
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  private servePairingPage(): Response {
    const code = this.db ? getActivePairingCode(this.db) : null;
    const name = this.gatewayInfo?.gatewayName ?? "Spaceduck Gateway";
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spaceduck Pairing</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e5e5e5; }
    .card { text-align: center; padding: 3rem 4rem; border: 1px solid #333; border-radius: 1rem; background: #141414; }
    h1 { font-size: 1.2rem; font-weight: 500; margin-bottom: 0.5rem; color: #a3a3a3; }
    .code-wrap { position: relative; display: inline-block; margin: 1.5rem 0; cursor: pointer; }
    .code-wrap:hover .copy-hint { opacity: 1; }
    .code { font-size: 4rem; font-weight: 700; letter-spacing: 0.5rem; font-variant-numeric: tabular-nums; color: #fff; user-select: all; }
    .copy-hint { position: absolute; top: -1.4rem; right: 0; font-size: 0.7rem; color: #737373; opacity: 0; transition: opacity 0.15s; }
    .copied-toast { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #141414ee; border-radius: 0.5rem; font-size: 1rem; color: #4ade80; opacity: 0; pointer-events: none; transition: opacity 0.2s; }
    .copied-toast.show { opacity: 1; }
    .no-code { font-size: 1.2rem; color: #737373; margin: 1.5rem 0; }
    .name { font-size: 0.85rem; color: #525252; margin-top: 1rem; }
    button { background: #262626; color: #e5e5e5; border: 1px solid #404040; padding: 0.5rem 1.5rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.9rem; margin-top: 1rem; }
    button:hover { background: #333; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Pairing Code</h1>
    ${code
      ? `<div class="code-wrap" onclick="copyCode()">
          <span class="copy-hint">click to copy</span>
          <div class="code" id="code">${code}</div>
          <div class="copied-toast" id="toast">Copied!</div>
        </div>
        <div><button onclick="fetch('/api/pair/start',{method:'POST'}).then(()=>location.reload())">Regenerate</button></div>`
      : `<div class="no-code">No active pairing session</div>
        <div><button onclick="fetch('/api/pair/start',{method:'POST'}).then(()=>location.reload())">Generate Code</button></div>`}
    <div class="name">${name}</div>
  </div>
  <script>
    function copyCode(){var c=document.getElementById('code');if(!c)return;navigator.clipboard.writeText(c.textContent.trim());var t=document.getElementById('toast');if(t){t.classList.add('show');setTimeout(function(){t.classList.remove('show')},1200)}}
    setTimeout(()=>location.reload(), 30000);
  </script>
</body>
</html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  private async handleUpload(req: Request): Promise<Response> {
    const { logger, attachmentStore } = this.deps;
    const maxSizeMb = Number(Bun.env.UPLOAD_MAX_SIZE_MB || "50");
    const maxSizeBytes = maxSizeMb * 1024 * 1024;

    try {
      const contentType = req.headers.get("content-type") || "";
      if (!contentType.includes("multipart/form-data")) {
        return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
      }

      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        return Response.json({ error: "Missing file field" }, { status: 400 });
      }

      if (file.size > maxSizeBytes) {
        return Response.json(
          { error: `File too large (max ${maxSizeMb}MB)` },
          { status: 413 },
        );
      }

      // Validate magic bytes — currently only PDF is supported
      const buffer = await file.arrayBuffer();
      const header = new Uint8Array(buffer.slice(0, 5));
      const pdfMagic = new TextDecoder().decode(header);
      if (!pdfMagic.startsWith("%PDF-")) {
        return Response.json(
          { error: "Invalid file: only PDF files are accepted" },
          { status: 415 },
        );
      }

      const id = `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      const ext = ".pdf";
      const localPath = `${attachmentStore.getUploadDir()}/${id}${ext}`;

      await Bun.write(localPath, buffer);

      attachmentStore.register(id, {
        localPath,
        filename: file.name,
        mimeType: "application/pdf",
        size: file.size,
      });

      logger.info("File uploaded", { id, filename: file.name, size: file.size });

      return Response.json({
        id,
        filename: file.name,
        mimeType: "application/pdf",
        size: file.size,
      });
    } catch (err) {
      logger.error("Upload failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.json({ error: "Upload failed" }, { status: 500 });
    }
  }

  async initStt(): Promise<void> {
    const productConfig = this.deps.configStore?.current;
    const sttConfig = productConfig?.stt;
    const backend = sttConfig?.backend ?? "whisper";
    const model = Bun.env.SPACEDUCK_STT_MODEL ?? sttConfig?.model ?? "small";
    const maxSeconds = Number(Bun.env.SPACEDUCK_STT_MAX_SECONDS ?? "120");
    const maxBytes = Number(Bun.env.SPACEDUCK_STT_MAX_BYTES ?? String(15 * 1024 * 1024));
    const timeoutMs = Number(Bun.env.SPACEDUCK_STT_TIMEOUT_MS ?? "300000");

    this.activeSttBackend = backend;

    if (backend === "aws-transcribe") {
      const awsConfig = sttConfig?.awsTranscribe ?? { region: "us-east-1", languageCode: "en-US", profile: null };
      const availability = await AwsTranscribeStt.isAvailable({
        region: awsConfig.region,
        profile: awsConfig.profile,
      });

      this.stt = {
        available: availability.ok,
        reason: availability.reason,
        backend: "aws-transcribe",
        model: "",
        language: awsConfig.languageCode ?? "en-US",
        maxSeconds,
        maxBytes,
        timeoutMs,
      };

      if (availability.ok) {
        this.awsTranscribeStt = new AwsTranscribeStt({
          region: awsConfig.region,
          languageCode: awsConfig.languageCode,
          profile: awsConfig.profile,
          timeoutMs,
        });
        this.deps.logger.info("STT enabled", {
          backend: "aws-transcribe",
          region: awsConfig.region,
        });
      } else {
        this.deps.logger.warn("STT unavailable (aws-transcribe)", {
          reason: availability.reason,
        });
      }
    } else {
      const availability = await WhisperStt.isAvailable();

      this.stt = {
        available: availability.ok,
        reason: availability.reason,
        backend: "whisper",
        model,
        language: Bun.env.SPACEDUCK_STT_LANGUAGE ?? "",
        maxSeconds,
        maxBytes,
        timeoutMs,
      };

      if (availability.ok) {
        this.whisperStt = new WhisperStt({ model, timeoutMs });
        this.deps.logger.info("STT enabled", { backend: "whisper", model });
      } else {
        this.deps.logger.warn("STT unavailable (whisper)", {
          reason: availability.reason,
        });
      }
    }
  }

  private async handleSttTest(): Promise<Response> {
    const backend = this.activeSttBackend;
    const startMs = Date.now();

    try {
      if (backend === "aws-transcribe") {
        const awsConfig = this.deps.configStore?.current?.stt?.awsTranscribe;
        const availability = await AwsTranscribeStt.isAvailable({
          region: awsConfig?.region,
          profile: awsConfig?.profile,
        });
        const durationMs = Date.now() - startMs;
        if (!availability.ok) {
          return Response.json({ ok: false, backend, error: availability.reason, durationMs });
        }
        return Response.json({ ok: true, backend, durationMs });
      }

      const availability = await WhisperStt.isAvailable();
      const durationMs = Date.now() - startMs;
      if (!availability.ok) {
        return Response.json({ ok: false, backend, error: availability.reason, durationMs });
      }
      return Response.json({ ok: true, backend, durationMs });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      return Response.json({
        ok: false,
        backend,
        error: err instanceof Error ? err.message : String(err),
        durationMs,
      });
    }
  }

  private async handleTranscribe(req: Request): Promise<Response> {
    const { logger } = this.deps;
    const requestId = `stt_${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

    if (!this.stt.available || (!this.whisperStt && !this.awsTranscribeStt)) {
      return Response.json(
        { requestId, error: "STT_UNAVAILABLE", message: `STT backend (${this.activeSttBackend}) is not available` },
        { status: 503 },
      );
    }

    // MIME check (cheap, header-only — do before touching the body)
    const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim();
    let mimeType = contentType;
    if (contentType === "application/octet-stream") {
      const sttMime = req.headers.get("x-stt-mime") ?? "";
      if (sttMime.startsWith("audio/")) {
        mimeType = sttMime;
      } else {
        return Response.json(
          { requestId, error: "UNSUPPORTED_TYPE", message: "Expected audio/* Content-Type" },
          { status: 415 },
        );
      }
    } else if (!contentType.startsWith("audio/")) {
      return Response.json(
        { requestId, error: "UNSUPPORTED_TYPE", message: "Expected audio/* Content-Type" },
        { status: 415 },
      );
    }

    const languageHint = req.headers.get("x-stt-language") ?? undefined;
    const ext = mimeToExt(mimeType);
    const filename = `spaceduck-stt-${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
    const tempPath = join(tmpdir(), filename);

    try {
      // Stream body to temp file with byte counting (no full buffering)
      if (!req.body) {
        return Response.json(
          { requestId, error: "UNSUPPORTED_TYPE", message: "Request has no body" },
          { status: 400 },
        );
      }

      let bytes = 0;
      const maxBytes = this.stt.maxBytes;
      const countingTransform = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > maxBytes) {
            controller.error(new Error("TOO_LARGE"));
            return;
          }
          controller.enqueue(chunk);
        },
      });

      const counted = req.body.pipeThrough(countingTransform);
      const out = createWriteStream(tempPath, { flags: "wx" });

      try {
        await pipeline(Readable.fromWeb(counted as any), out);
      } catch (err: any) {
        if (err?.message === "TOO_LARGE" || (err?.cause && String(err.cause).includes("TOO_LARGE"))) {
          return Response.json(
            { requestId, error: "TOO_LARGE", message: `File too large (max ${Math.round(maxBytes / 1024 / 1024)}MB)` },
            { status: 413 },
          );
        }
        throw err;
      }

      const startTime = Date.now();
      const sttProvider = this.activeSttBackend === "aws-transcribe"
        ? this.awsTranscribeStt!
        : this.whisperStt!;
      const result = await sttProvider.transcribeFile(tempPath, { languageHint });
      const durationMs = Date.now() - startTime;

      logger.info("STT transcribed", { requestId, durationMs, language: result.language, bytes });

      return Response.json({
        requestId,
        text: result.text,
        language: result.language,
        segments: result.segments,
        durationMs,
      });
    } catch (err) {
      if (err instanceof SttError || err instanceof AwsSttError) {
        const status = sttErrorToStatus(err.code);
        return Response.json(
          { requestId, error: err.code, message: err.message },
          { status },
        );
      }
      logger.error("STT failed", {
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.json(
        { requestId, error: "UNKNOWN", message: "Transcription failed" },
        { status: 500 },
      );
    } finally {
      try {
        await unlink(tempPath);
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

const MIME_EXT_MAP: Record<string, string> = {
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/flac": ".flac",
};

function mimeToExt(mime: string): string {
  return MIME_EXT_MAP[mime] ?? ".bin";
}

function sttErrorToStatus(code: string): number {
  switch (code) {
    case "STT_UNAVAILABLE": return 503;
    case "TOO_LARGE": return 413;
    case "UNSUPPORTED_TYPE": return 415;
    case "INVALID_AUDIO": return 400;
    case "TIMEOUT": return 504;
    case "MODEL_NOT_FOUND": return 503;
    case "BINARY_NOT_FOUND": return 503;
    case "CREDENTIALS_MISSING": return 503;
    case "SERVICE_ERROR": return 502;
    case "PARSE_ERROR": return 500;
    default: return 500;
  }
}

/**
 * Create a fully-wired Gateway from environment config.
 * This is the main factory function — call it from index.ts.
 */
// ── AI secret paths that trigger provider rebuild ────────────────────

const AI_SECRET_PATHS = new Set([
  "/ai/secrets/geminiApiKey",
  "/ai/secrets/bedrockApiKey",
  "/ai/secrets/openrouterApiKey",
  "/ai/secrets/lmstudioApiKey",
  "/ai/secrets/llamacppApiKey",
]);

const PROVIDER_REBUILD_PATHS = new Set([
  "/ai/provider",
  "/ai/model",
  "/ai/baseUrl",
  "/ai/region",
]);

const EMBEDDING_REBUILD_PATHS = new Set([
  "/ai/provider",
  "/embedding/enabled",
  "/embedding/provider",
  "/embedding/model",
  "/embedding/baseUrl",
  "/embedding/dimensions",
]);

// ── Tool and channel hot-swap path sets ─────────────────────────────

type SwapResult = { ok: true } | { ok: false; code: string; message: string };

const TOOL_REBUILD_PATHS = new Set([
  "/tools/webSearch/provider",
  "/tools/webSearch/searxngUrl",
  "/tools/webAnswer/enabled",
  "/tools/marker/enabled",
  "/tools/browser/enabled",
  "/tools/browser/livePreview",
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

const STT_REBUILD_PATHS = new Set([
  "/stt/backend",
  "/stt/model",
  "/stt/awsTranscribe/region",
  "/stt/awsTranscribe/languageCode",
  "/stt/awsTranscribe/profile",
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

function shouldRebuildStt(changedPaths: Set<string>): boolean {
  for (const p of STT_REBUILD_PATHS) {
    if (changedPaths.has(p)) return true;
  }
  return false;
}

// ── Provider factory ─────────────────────────────────────────────────

/**
 * Build a Provider instance from product config.
 * Throws if the selected provider requires an API key that isn't set.
 */
// ── Provider test helpers ────────────────────────────────────────────

const LOCAL_PROVIDER_IDS = new Set(["llamacpp", "lmstudio", "custom"]);
const CLOUD_PROVIDER_IDS = new Set(["gemini", "openrouter", "bedrock"]);

interface ProviderTestParsed {
  provider: string;
  baseUrl: string | null;
  model: string | null;
  region: string | null;
  secretSlot: string | null;
}

function parseProviderTestRequest(
  body: Record<string, unknown>,
): { ok: true; value: ProviderTestParsed } | { ok: false; error: string } {
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  if (!provider) return { ok: false, error: "Missing required field: provider" };

  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : null;
  const model = typeof body.model === "string" ? body.model.trim() : null;
  const region = typeof body.region === "string" ? body.region.trim() : null;
  const secretSlot = typeof body.secretSlot === "string" ? body.secretSlot.trim() : null;

  if (LOCAL_PROVIDER_IDS.has(provider) && !baseUrl) {
    return { ok: false, error: "baseUrl is required for local providers" };
  }
  if (CLOUD_PROVIDER_IDS.has(provider) && !secretSlot) {
    return { ok: false, error: "secretSlot is required for cloud providers" };
  }
  if (provider === "bedrock" && !region) {
    return { ok: false, error: "region is required for Bedrock" };
  }

  return { ok: true, value: { provider, baseUrl, model, region, secretSlot } };
}

function resolveSecretFromConfig(
  cfg: SpaceduckProductConfig,
  slot: string,
): string | null {
  const map: Record<string, string | null> = {
    "/ai/secrets/geminiApiKey": cfg.ai.secrets.geminiApiKey,
    "/ai/secrets/openrouterApiKey": cfg.ai.secrets.openrouterApiKey,
    "/ai/secrets/bedrockApiKey": cfg.ai.secrets.bedrockApiKey,
    "/ai/secrets/lmstudioApiKey": cfg.ai.secrets.lmstudioApiKey,
    "/ai/secrets/llamacppApiKey": cfg.ai.secrets.llamacppApiKey,
  };
  return map[slot] ?? null;
}

function normalizeProviderBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  url = url.replace(/\/chat\/completions$/, "");
  url = url.replace(/\/+$/, "");
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/" || parsed.pathname === "") {
      url += "/v1";
    } else if (!parsed.pathname.endsWith("/v1")) {
      // Only append /v1 if the path is just a port root — don't mangle custom paths
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length === 0) {
        url += "/v1";
      }
    }
  } catch {
    if (!url.endsWith("/v1")) url += "/v1";
  }
  return url;
}

interface ProviderTestError {
  code: string;
  message: string;
  retryable: boolean;
}

function mapProviderTestError(err: unknown): ProviderTestError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("econnrefused") || lower.includes("connection refused")) {
    return { code: "ECONNREFUSED", message: "Connection refused. Start your local server, then try again.", retryable: true };
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborted")) {
    return { code: "TIMEOUT", message: "Connection timed out. Check that the server is running and reachable.", retryable: true };
  }
  if (lower.includes("unauthorized") || lower.includes("401")) {
    return { code: "UNAUTHORIZED", message: "Authentication failed. Check your API key.", retryable: false };
  }
  if (lower.includes("invalid") && lower.includes("key")) {
    return { code: "INVALID_KEY", message: "Invalid API key. Double-check the key and try again.", retryable: false };
  }
  if (lower.includes("access denied") || lower.includes("403")) {
    return { code: "UNAUTHORIZED", message: "Access denied. Check your credentials and permissions.", retryable: false };
  }
  if (lower.includes("not found") && lower.includes("model")) {
    return { code: "BEDROCK_MODEL_UNAVAILABLE", message: "Model not available. Check the model ID and region.", retryable: false };
  }
  if (lower.includes("region")) {
    return { code: "BEDROCK_REGION_MISSING", message: "Invalid or missing AWS region.", retryable: false };
  }

  return { code: "UNKNOWN", message: msg || "Connection test failed.", retryable: true };
}

interface ProbeInput {
  provider: string;
  baseUrl?: string;
  model?: string;
  region?: string;
  secret: string | null;
  logger: Logger;
}

async function probeProvider(
  input: ProbeInput,
): Promise<{ ok: true; normalizedBaseUrl: string | null } | { ok: false; error: ProviderTestError; details?: Record<string, unknown> }> {
  const { provider, baseUrl, model, region, secret, logger } = input;

  if (LOCAL_PROVIDER_IDS.has(provider) && baseUrl) {
    const normalized = normalizeProviderBaseUrl(baseUrl);
    const headers: Record<string, string> = {};
    if (secret) {
      headers["Authorization"] = `Bearer ${secret}`;
    }
    try {
      const res = await fetch(`${normalized}/models`, {
        headers,
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        return { ok: true, normalizedBaseUrl: normalized };
      }
      if (res.status === 404) {
        const healthRes = await fetch(normalized.replace(/\/v1$/, ""), {
          headers,
          signal: AbortSignal.timeout(5_000),
        }).catch(() => null);
        if (healthRes?.ok) {
          return { ok: true, normalizedBaseUrl: normalized };
        }
      }
      return {
        ok: false,
        error: { code: "ECONNREFUSED", message: `Server responded with ${res.status}. Check the URL and server status.`, retryable: true },
        details: { provider, hint: "Expected an OpenAI-compatible endpoint like http://127.0.0.1:8080/v1" },
      };
    } catch (err) {
      return {
        ok: false,
        error: mapProviderTestError(err),
        details: { provider, hint: "Expected an OpenAI-compatible endpoint like http://127.0.0.1:8080/v1" },
      };
    }
  }

  if (provider === "gemini" && secret) {
    try {
      const { GeminiProvider } = require("@spaceduck/provider-gemini") as { GeminiProvider: new (cfg: { apiKey: string; model?: string }) => Provider };
      const tmp = new GeminiProvider({ apiKey: secret, model: model || "gemini-2.5-flash" });
      const chunks: string[] = [];
      for await (const chunk of tmp.chat(
        [{ id: "probe", role: "user" as const, content: "Say OK", timestamp: Date.now(), source: "system" as const }],
        { signal: AbortSignal.timeout(8_000) },
      )) {
        if (chunk.type === "text") chunks.push(chunk.text);
        if (chunks.join("").length > 5) break;
      }
      return { ok: true, normalizedBaseUrl: null };
    } catch (err) {
      return { ok: false, error: mapProviderTestError(err) };
    }
  }

  if (provider === "openrouter" && secret) {
    try {
      const { OpenRouterProvider } = require("@spaceduck/provider-openrouter") as { OpenRouterProvider: new (cfg: { apiKey: string; model?: string }) => Provider };
      const tmp = new OpenRouterProvider({ apiKey: secret, model: model || "google/gemini-2.5-flash" });
      const chunks: string[] = [];
      for await (const chunk of tmp.chat(
        [{ id: "probe", role: "user" as const, content: "Say OK", timestamp: Date.now(), source: "system" as const }],
        { signal: AbortSignal.timeout(8_000) },
      )) {
        if (chunk.type === "text") chunks.push(chunk.text);
        if (chunks.join("").length > 5) break;
      }
      return { ok: true, normalizedBaseUrl: null };
    } catch (err) {
      return { ok: false, error: mapProviderTestError(err) };
    }
  }

  if (provider === "bedrock") {
    try {
      const { BedrockProvider } = require("@spaceduck/provider-bedrock") as { BedrockProvider: new (cfg: { model?: string; region?: string; apiKey?: string }) => Provider };
      const tmp = new BedrockProvider({
        model: model || "us.amazon.nova-2-pro-v1:0",
        region: region || undefined,
        apiKey: secret || undefined,
      });
      const chunks: string[] = [];
      for await (const chunk of tmp.chat(
        [{ id: "probe", role: "user" as const, content: "Say OK", timestamp: Date.now(), source: "system" as const }],
        { signal: AbortSignal.timeout(8_000) },
      )) {
        if (chunk.type === "text") chunks.push(chunk.text);
        if (chunks.join("").length > 5) break;
      }
      return { ok: true, normalizedBaseUrl: null };
    } catch (err) {
      return {
        ok: false,
        error: mapProviderTestError(err),
        details: { provider: "bedrock", region: region ?? "not set" },
      };
    }
  }

  return {
    ok: false,
    error: { code: "UNKNOWN", message: `Unsupported provider: ${provider}`, retryable: false },
  };
}

// ── Null provider (used when no provider is configured yet) ──────────

class NullProvider implements Provider {
  readonly name = "unconfigured";

  async *chat(): AsyncIterable<ProviderChunk> {
    yield {
      type: "text",
      text: "No AI provider is configured yet. Go to Settings → Chat to set one up.",
    };
  }
}

// ── Provider factory ─────────────────────────────────────────────────

function buildProvider(
  productConfig: SpaceduckProductConfig,
  logger: Logger,
): Provider {
  const providerName = productConfig.ai.provider;
  const modelName = productConfig.ai.model;
  const aiSecrets = productConfig.ai.secrets;

  const requireKey = (name: string, key: string | null): string => {
    if (!key) {
      throw new Error(
        `${name} API key not configured. Set it via Settings or spaceduck.config.json5`,
      );
    }
    return key;
  };

  if (providerName === "gemini") {
    const { GeminiProvider } = require("@spaceduck/provider-gemini");
    return new GeminiProvider({
      apiKey: requireKey("Gemini", aiSecrets.geminiApiKey),
      model: modelName,
    });
  }
  if (providerName === "openrouter") {
    const { OpenRouterProvider } = require("@spaceduck/provider-openrouter");
    return new OpenRouterProvider({
      apiKey: requireKey("OpenRouter", aiSecrets.openrouterApiKey),
      model: modelName,
    });
  }
  if (providerName === "lmstudio") {
    const { LMStudioProvider } = require("@spaceduck/provider-lmstudio");
    return new LMStudioProvider({
      model: modelName,
      baseUrl: productConfig.ai.baseUrl ?? Bun.env.LMSTUDIO_BASE_URL,
      apiKey: aiSecrets.lmstudioApiKey,
    });
  }
  if (providerName === "llamacpp") {
    const { LlamaCppProvider } = require("@spaceduck/provider-llamacpp");
    return new LlamaCppProvider({
      model: modelName,
      baseUrl: productConfig.ai.baseUrl ?? Bun.env.LLAMACPP_BASE_URL,
      apiKey: aiSecrets.llamacppApiKey,
    });
  }
  if (providerName === "bedrock") {
    const { BedrockProvider } = require("@spaceduck/provider-bedrock");
    return new BedrockProvider({
      model: modelName,
      region: productConfig.ai.region ?? Bun.env.AWS_REGION,
      apiKey: aiSecrets.bedrockApiKey ?? undefined,
    });
  }

  throw new Error(`Unknown provider: ${providerName}`);
}

// ── Config write serialisation ───────────────────────────────────────

let configWriteChain: Promise<void> = Promise.resolve();

function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = configWriteChain.then(fn, fn);
  configWriteChain = next.then(
    () => {},
    () => {},
  );
  return next;
}

// ── Gateway factory ──────────────────────────────────────────────────

export async function createGateway(overrides?: {
  provider?: Provider;
  embeddingProvider?: EmbeddingProvider;
  config?: SpaceduckConfig;
}): Promise<Gateway> {
  // Load deployment config (port, logLevel, etc.) from env
  const configResult = overrides?.config
    ? { ok: true as const, value: overrides.config }
    : loadConfig();

  if (!configResult.ok) {
    console.error("Configuration error:", configResult.error.message);
    process.exit(1);
  }

  const config = configResult.value;

  // Create logger
  const logger = new ConsoleLogger(config.logLevel);

  // Load product config from JSON5 file via ConfigStore
  const configStore = new ConfigStore();
  const productConfig = await configStore.load();
  logger.info("Product config loaded", {
    provider: productConfig.ai.provider,
    model: productConfig.ai.model,
  });

  // Create event bus
  const eventBus = new SimpleEventBus(logger);

  // Swap to Homebrew SQLite on macOS (must happen before any new Database())
  ensureCustomSQLite();

  // Create SQLite database
  const db = new Database(config.memory.connectionString);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  // Load sqlite-vec extension + run migrations
  const schema = new SchemaManager(db, logger);
  schema.loadExtensions();
  await schema.migrate();

  // Create embedding provider (optional — disabled if EMBEDDING_ENABLED=false)
  const swappableEmbeddingProvider = (() => {
    if (overrides?.embeddingProvider) {
      return new SwappableEmbeddingProvider(overrides.embeddingProvider);
    }
    try {
      return new SwappableEmbeddingProvider(
        createEmbeddingProvider(config, logger, productConfig),
      );
    } catch (err) {
      logger.warn("Embedding provider not ready — starting without one", {
        reason: err instanceof Error ? err.message : String(err),
      });
      return new SwappableEmbeddingProvider(undefined);
    }
  })();

  // Reconcile vec_facts virtual table dimensions with the active embedding provider
  reconcileVecFacts(
    db,
    swappableEmbeddingProvider.current,
    logger,
    config.memory.connectionString,
  );

  // Reconcile vec_memories virtual table for Memory v2
  reconcileVecMemories(
    db,
    swappableEmbeddingProvider.current,
    logger,
  );

  // Create memory layer
  const conversationStore = new SqliteConversationStore(db, logger);
  const sessionManager = new SqliteSessionManager(db, logger);

  // Build swappable AI provider (can be hot-swapped on config change)
  let provider: Provider;
  const swappableProvider = (() => {
    if (overrides?.provider) return new SwappableProvider(overrides.provider);
    try {
      return new SwappableProvider(buildProvider(productConfig, logger));
    } catch (err) {
      logger.warn("AI provider not ready — gateway starting without one", {
        reason: err instanceof Error ? err.message : String(err),
      });
      return new SwappableProvider(new NullProvider());
    }
  })();
  provider = swappableProvider;

  // Memory store (with provider for contradiction detection in semantic dedup)
  const memoryStore = new SqliteMemoryStore(db, logger, swappableEmbeddingProvider, provider);

  // Create context builder
  const contextBuilder = new DefaultContextBuilder(
    conversationStore,
    logger,
    productConfig.ai.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    memoryStore,
  );

  // Create run lock
  const runLock = new RunLock();

  // Create attachment store for file uploads
  const attachmentStore = new AttachmentStore();

  // Create per-conversation browser session pool + conversation context ref
  const conversationIdRef = { current: "" };
  const browserFrame = createBrowserFrameTarget();
  const browserPool = configStore ? new BrowserSessionPool({
    configStore,
    logger,
    onNewSession: (convId, browser) => {
      const livePreview = configStore.current?.tools?.browser?.livePreview ?? false;
      if (livePreview) {
        browser.startScreencast((frame) => browserFrame.onFrame(convId, frame)).catch((e) => {
          logger.warn("Failed to start screencast", { conversationId: convId, error: String(e) });
        });
      }
    },
  }) : undefined;

  // Create tool registry with built-in tools
  const toolRegistry = buildToolRegistry(
    logger, attachmentStore, configStore, undefined,
    browserPool, () => conversationIdRef.current,
  );

  // Wire memory extractor (v2) — classifies and stores typed memories from assistant responses
  const memoryExtractor = new MemoryExtractor(memoryStore, logger, provider);
  memoryExtractor.register(eventBus);

  // Create agent loop
  const agent = new AgentLoop({
    provider,
    conversationStore,
    contextBuilder,
    sessionManager,
    eventBus,
    logger,
    memoryExtractor,
    toolRegistry,
  });

  // Create external channels (opt-in via product config)
  const channels = buildChannels(productConfig, logger);

  const gateway = new Gateway({
    config,
    logger,
    eventBus,
    provider,
    conversationStore,
    memoryStore,
    sessionManager,
    agent,
    runLock,
    embeddingProvider: swappableEmbeddingProvider,
    channels,
    attachmentStore,
    configStore,
    swappableProvider,
    swappableEmbeddingProvider,
    contextBuilder,
    browserPool,
    conversationIdRef,
    browserFrame,
  }, db);

  await gateway.initStt();

  gateway.toolStatusService = new ToolStatusService(() => agent.toolRegistry, configStore ?? undefined);

  return gateway;
}

// ── Bedrock model discovery ─────────────────────────────────────────

interface BedrockModelSummary {
  modelId: string;
  modelName: string;
  providerName: string;
  inputModalities: string[];
  outputModalities: string[];
  responseStreamingSupported: boolean;
  modelLifecycle: { status: string };
}

async function fetchBedrockModels(
  config: import("@spaceduck/config").SpaceduckProductConfig,
): Promise<{ id: string; name: string; provider?: string }[]> {
  const region = config.ai.region ?? Bun.env.AWS_REGION ?? "us-east-1";
  const apiKey =
    config.ai.secrets.bedrockApiKey ??
    Bun.env.AWS_BEARER_TOKEN_BEDROCK ??
    "";

  const res = await fetch(
    `https://bedrock.${region}.amazonaws.com/foundation-models`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    },
  );

  if (!res.ok) throw new Error(`Bedrock ${res.status}`);

  const data = (await res.json()) as { modelSummaries: BedrockModelSummary[] };

  return data.modelSummaries
    .filter(
      (m) =>
        m.modelLifecycle.status === "ACTIVE" &&
        m.inputModalities.includes("TEXT") &&
        m.outputModalities.includes("TEXT"),
    )
    .map((m) => ({
      id: m.modelId,
      name: m.modelName,
      provider: m.providerName,
    }));
}
