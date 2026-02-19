// Gateway: composition root that wires all dependencies and manages lifecycle

// Bun HTML import — auto-bundles <script>/<link> tags for fullstack dev server
// @ts-ignore: Bun HTML import
import homepage from "@spaceduck/web/index.html";

import { Database } from "bun:sqlite";
import {
  type SpaceduckConfig,
  type Logger,
  type Provider,
  type ConversationStore,
  type LongTermMemory,
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
  FactExtractor,
  loadConfig,
  ToolRegistry,
} from "@spaceduck/core";
import type { EventBus } from "@spaceduck/core";
import {
  SchemaManager,
  ensureCustomSQLite,
  SqliteConversationStore,
  SqliteLongTermMemory,
  SqliteSessionManager,
} from "@spaceduck/memory-sqlite";
import { RunLock } from "./run-lock";
import { createWsHandler, type WsConnectionData } from "./ws-handler";
import { createToolRegistry } from "./tool-registrations";
import { createEmbeddingProvider } from "./embedding-factory";
import { AttachmentStore } from "./attachment-store";
import {
  ensureGatewaySettings,
  getGatewayInfo,
  createPairingSession,
  getActivePairingCode,
  confirmPairing,
  requireAuth,
  extractToken,
  verifyToken,
  listTokens,
  revokeToken,
  type GatewayInfo,
} from "./auth";

export interface GatewayDeps {
  readonly config: SpaceduckConfig;
  readonly logger: Logger;
  readonly eventBus: EventBus;
  readonly provider: Provider;
  readonly conversationStore: ConversationStore;
  readonly longTermMemory: LongTermMemory;
  readonly sessionManager: SessionManager;
  readonly agent: AgentLoop;
  readonly runLock: RunLock;
  readonly embeddingProvider?: EmbeddingProvider;
  readonly channels?: Channel[];
  readonly attachmentStore: AttachmentStore;
}

export class Gateway implements Lifecycle {
  private _status: LifecycleStatus = "stopped";
  private server: ReturnType<typeof Bun.serve> | null = null;
  private db: Database | null = null;
  private authRequired: boolean;
  private gatewayInfo: GatewayInfo | null = null;

  readonly deps: GatewayDeps;

  constructor(deps: GatewayDeps, db?: Database) {
    this.deps = deps;
    this.db = db ?? null;
    this.authRequired = (Bun.env.SPACEDUCK_REQUIRE_AUTH ?? "1") !== "0";
  }

  get status(): LifecycleStatus {
    return this._status;
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
    });

    this.server = Bun.serve<WsConnectionData>({
      port: config.port,
      // Bun fullstack: HTML imports auto-bundle <script> and <link> tags
      routes: {
        "/": homepage,
      },
      development: config.logLevel === "debug",
      fetch: (req, server) => this.handleRequest(req, server),
      websocket: {
        message: wsHandler.message,
        open: wsHandler.open,
        close: wsHandler.close,
      },
    });

    this._status = "running";

    // Start external channels (WhatsApp, etc.)
    await this.startChannels();

    logger.info("Gateway started", {
      port: config.port,
      provider: config.provider.name,
      model: config.provider.model,
      memory: config.memory.backend,
      embedding: this.deps.embeddingProvider?.name ?? "disabled",
    });
  }

  async stop(): Promise<void> {
    if (this._status === "stopped" || this._status === "stopping") return;
    this._status = "stopping";

    // Stop external channels
    await this.stopChannels();

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

  private async startChannels(): Promise<void> {
    const channels = this.deps.channels ?? [];
    const { logger, agent, conversationStore, sessionManager, runLock } = this.deps;

    for (const channel of channels) {
      channel.onMessage(async (msg) => {
        await this.handleChannelMessage(channel, msg);
      });

      try {
        await channel.start();
        logger.info("Channel started", { channel: channel.name });
      } catch (err) {
        logger.error("Failed to start channel", {
          channel: channel.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async stopChannels(): Promise<void> {
    const channels = this.deps.channels ?? [];
    for (const channel of channels) {
      try {
        await channel.stop();
      } catch {
        // Best-effort
      }
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

  private async handleRequest(req: Request, server: Bun.Server<WsConnectionData>): Promise<Response> {
    const url = new URL(req.url);

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
      return Response.json({
        status: "ok",
        uptime: process.uptime(),
        provider: this.deps.config.provider.name,
        model: this.deps.config.provider.model,
        memory: this.deps.config.memory.backend,
        embedding: this.deps.embeddingProvider?.name ?? "disabled",
      });
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
      const session = createPairingSession(this.db);
      const logCode = (Bun.env.SPACEDUCK_PAIRING_LOG_CODE ?? "0") === "1";
      if (logCode) {
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
    .code { font-size: 4rem; font-weight: 700; letter-spacing: 0.5rem; font-variant-numeric: tabular-nums; margin: 1.5rem 0; color: #fff; }
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
      ? `<div class="code">${code}</div>`
      : `<div class="no-code">No active pairing session</div>`}
    <button onclick="fetch('/api/pair/start',{method:'POST'}).then(()=>location.reload())">
      ${code ? "Regenerate" : "Generate Code"}
    </button>
    <div class="name">${name}</div>
  </div>
  <script>setTimeout(()=>location.reload(), 30000)</script>
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
}

/**
 * Create a fully-wired Gateway from environment config.
 * This is the main factory function — call it from index.ts.
 */
export async function createGateway(overrides?: {
  provider?: Provider;
  embeddingProvider?: EmbeddingProvider;
  config?: SpaceduckConfig;
}): Promise<Gateway> {
  // Load config
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
  const embeddingProvider = overrides?.embeddingProvider ?? createEmbeddingProvider(config, logger);

  // Create memory layer — pass embedding provider for vector search
  const conversationStore = new SqliteConversationStore(db, logger);
  const longTermMemory = new SqliteLongTermMemory(db, logger, embeddingProvider);
  const sessionManager = new SqliteSessionManager(db, logger);

  // Create provider
  let provider: Provider;
  if (overrides?.provider) {
    provider = overrides.provider;
  } else if (config.provider.name === "gemini") {
    const { GeminiProvider } = require("@spaceduck/provider-gemini");
    provider = new GeminiProvider({
      apiKey: Bun.env.GEMINI_API_KEY!,
      model: config.provider.model,
    });
  } else if (config.provider.name === "openrouter") {
    const { OpenRouterProvider } = require("@spaceduck/provider-openrouter");
    provider = new OpenRouterProvider({
      apiKey: Bun.env.OPENROUTER_API_KEY!,
      model: config.provider.model,
    });
  } else if (config.provider.name === "lmstudio") {
    const { LMStudioProvider } = require("@spaceduck/provider-lmstudio");
    provider = new LMStudioProvider({
      model: config.provider.model!,
      baseUrl: Bun.env.LMSTUDIO_BASE_URL,
      apiKey: Bun.env.LMSTUDIO_API_KEY,
    });
  } else if (config.provider.name === "bedrock") {
    const { BedrockProvider } = require("@spaceduck/provider-bedrock");
    provider = new BedrockProvider({
      model: config.provider.model,
      region: Bun.env.AWS_REGION,
    });
  } else {
    logger.error("Unknown provider", { name: config.provider.name });
    process.exit(1);
  }

  // Create context builder
  const contextBuilder = new DefaultContextBuilder(
    conversationStore,
    longTermMemory,
    logger,
    config.systemPrompt,
  );

  // Create run lock
  const runLock = new RunLock();

  // Create attachment store for file uploads
  const attachmentStore = new AttachmentStore();

  // Create tool registry with built-in tools
  const toolRegistry = createToolRegistry(logger, attachmentStore);

  // Create agent loop
  const agent = new AgentLoop({
    provider,
    conversationStore,
    contextBuilder,
    sessionManager,
    eventBus,
    logger,
    longTermMemory,
    toolRegistry,
  });

  // Wire fact extractor to extract durable facts from assistant responses
  // Uses the LLM provider for intelligent extraction (falls back to regex if unavailable)
  const factExtractor = new FactExtractor(longTermMemory, logger, provider);
  factExtractor.register(eventBus);

  // Create external channels (opt-in via env vars)
  const channels: Channel[] = [];

  if (Bun.env.WHATSAPP_ENABLED === "true") {
    const { WhatsAppChannel } = require("@spaceduck/channel-whatsapp");
    channels.push(
      new WhatsAppChannel({
        logger,
        authDir: Bun.env.WHATSAPP_AUTH_DIR,
      }),
    );
  }

  return new Gateway({
    config,
    logger,
    eventBus,
    provider,
    conversationStore,
    longTermMemory,
    sessionManager,
    agent,
    runLock,
    embeddingProvider,
    channels,
    attachmentStore,
  }, db);
}
