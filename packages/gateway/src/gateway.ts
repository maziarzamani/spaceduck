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
import { WhisperStt, SttError } from "@spaceduck/stt-whisper";
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
} from "./config";
import type { ConfigPatchOp } from "@spaceduck/config";
import { isSecretPath } from "@spaceduck/config";

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
  readonly configStore?: ConfigStore;
}

export class Gateway implements Lifecycle {
  private _status: LifecycleStatus = "stopped";
  private server: ReturnType<typeof Bun.serve> | null = null;
  private db: Database | null = null;
  private authRequired: boolean;
  private gatewayInfo: GatewayInfo | null = null;
  private whisperStt: WhisperStt | null = null;
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
      fetch: async (req, server) => {
        const resp = await this.handleRequest(req, server);
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

  private corsHeaders(req: Request): Record<string, string> {
    return {
      "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-STT-Language",
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
      return Response.json({
        status: "ok",
        uptime: process.uptime(),
        provider: this.deps.config.provider.name,
        model: this.deps.config.provider.model,
        memory: this.deps.config.memory.backend,
        embedding: this.deps.embeddingProvider?.name ?? "disabled",
      });
    }

    // STT status (unauthenticated — no secrets exposed)
    if (req.method === "GET" && url.pathname === "/api/stt/status") {
      return Response.json(this.stt.available
        ? {
            available: true,
            backend: this.stt.backend,
            model: this.stt.model,
            language: this.stt.language || undefined,
            maxSeconds: this.stt.maxSeconds,
            maxBytes: this.stt.maxBytes,
            timeoutMs: this.stt.timeoutMs,
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

      // STT transcribe
      if (req.method === "POST" && url.pathname === "/api/stt/transcribe") {
        if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
        return this.handleTranscribe(req);
      }

      // ── Config API routes ──────────────────────────────────────

      const configStore = this.deps.configStore;
      if (configStore) {
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
            const response: Record<string, unknown> = {
              config: result.config,
              rev: result.rev,
            };
            if (result.needsRestart) {
              response.needsRestart = result.needsRestart;
            }
            return Response.json(response, {
              headers: { ETag: result.rev },
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
            if (body.op === "set") {
              if (!body.value || typeof body.value !== "string") {
                return Response.json(
                  { error: "INVALID_BODY", message: "Missing value for set op" },
                  { status: 400 },
                );
              }
              await configStore.setSecret(body.path, body.value);
            } else if (body.op === "unset") {
              await configStore.unsetSecret(body.path);
            } else {
              return Response.json(
                { error: "INVALID_OP", message: `Unknown op "${body.op}" — use "set" or "unset"` },
                { status: 400 },
              );
            }
            return Response.json({ ok: true });
          } catch {
            return Response.json(
              { error: "INVALID_BODY", message: "Invalid JSON body" },
              { status: 400 },
            );
          }
        }
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

  async initStt(): Promise<void> {
    const model = Bun.env.SPACEDUCK_STT_MODEL ?? "small";
    const maxSeconds = Number(Bun.env.SPACEDUCK_STT_MAX_SECONDS ?? "120");
    const maxBytes = Number(Bun.env.SPACEDUCK_STT_MAX_BYTES ?? String(15 * 1024 * 1024));
    const timeoutMs = Number(Bun.env.SPACEDUCK_STT_TIMEOUT_MS ?? "300000");

    const availability = await WhisperStt.isAvailable();

    this.stt = {
      available: availability.ok,
      reason: availability.reason,
      backend: "whisper",
      model,
      maxSeconds,
      maxBytes,
      timeoutMs,
    };

    if (availability.ok) {
      this.whisperStt = new WhisperStt({ model, timeoutMs });
      this.deps.logger.info("STT enabled", { backend: "whisper", model });
    } else {
      this.deps.logger.warn("STT unavailable", { reason: availability.reason });
    }
  }

  private async handleTranscribe(req: Request): Promise<Response> {
    const { logger } = this.deps;
    const requestId = `stt_${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

    if (!this.stt.available || !this.whisperStt) {
      return Response.json(
        { requestId, error: "STT_UNAVAILABLE", message: "whisper is not installed" },
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
      const result = await this.whisperStt.transcribeFile(tempPath, { languageHint });
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
      if (err instanceof SttError) {
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
    case "PARSE_ERROR": return 500;
    default: return 500;
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
  const embeddingProvider = overrides?.embeddingProvider ?? createEmbeddingProvider(config, logger);

  // Create memory layer — pass embedding provider for vector search
  const conversationStore = new SqliteConversationStore(db, logger);
  const longTermMemory = new SqliteLongTermMemory(db, logger, embeddingProvider);
  const sessionManager = new SqliteSessionManager(db, logger);

  // Resolve API keys: product config secrets take priority, fall back to env vars
  const aiSecrets = productConfig.ai.secrets;
  const geminiApiKey = aiSecrets.geminiApiKey ?? Bun.env.GEMINI_API_KEY;
  const openrouterApiKey = aiSecrets.openrouterApiKey ?? Bun.env.OPENROUTER_API_KEY;
  const lmstudioApiKey = aiSecrets.lmstudioApiKey ?? Bun.env.LMSTUDIO_API_KEY;
  const bedrockApiKey = aiSecrets.bedrockApiKey ?? Bun.env.AWS_BEARER_TOKEN_BEDROCK;

  // Create provider (use product config for provider/model selection)
  let provider: Provider;
  const providerName = productConfig.ai.provider;
  const modelName = productConfig.ai.model;
  if (overrides?.provider) {
    provider = overrides.provider;
  } else if (providerName === "gemini") {
    const { GeminiProvider } = require("@spaceduck/provider-gemini");
    provider = new GeminiProvider({
      apiKey: geminiApiKey!,
      model: modelName,
    });
  } else if (providerName === "openrouter") {
    const { OpenRouterProvider } = require("@spaceduck/provider-openrouter");
    provider = new OpenRouterProvider({
      apiKey: openrouterApiKey!,
      model: modelName,
    });
  } else if (providerName === "lmstudio") {
    const { LMStudioProvider } = require("@spaceduck/provider-lmstudio");
    provider = new LMStudioProvider({
      model: modelName,
      baseUrl: Bun.env.LMSTUDIO_BASE_URL,
      apiKey: lmstudioApiKey,
    });
  } else if (providerName === "bedrock") {
    const { BedrockProvider } = require("@spaceduck/provider-bedrock");
    provider = new BedrockProvider({
      model: modelName,
      region: productConfig.ai.region ?? Bun.env.AWS_REGION,
    });
  } else {
    logger.error("Unknown provider", { name: providerName });
    process.exit(1);
  }

  // Create context builder
  const contextBuilder = new DefaultContextBuilder(
    conversationStore,
    longTermMemory,
    logger,
    productConfig.ai.systemPrompt ?? config.systemPrompt,
  );

  // Create run lock
  const runLock = new RunLock();

  // Create attachment store for file uploads
  const attachmentStore = new AttachmentStore();

  // Create tool registry with built-in tools
  const toolRegistry = createToolRegistry(logger, attachmentStore);

  // Wire fact extractor to extract durable facts from assistant responses
  // Uses the LLM provider for intelligent extraction (falls back to regex if unavailable)
  const factExtractor = new FactExtractor(longTermMemory, logger, provider);
  factExtractor.register(eventBus);

  // Create agent loop (factExtractor enables pre-context regex extraction)
  const agent = new AgentLoop({
    provider,
    conversationStore,
    contextBuilder,
    sessionManager,
    eventBus,
    logger,
    longTermMemory,
    factExtractor,
    toolRegistry,
  });

  // Create external channels (opt-in via product config)
  const channels: Channel[] = [];

  if (productConfig.channels.whatsapp.enabled) {
    const { WhatsAppChannel } = require("@spaceduck/channel-whatsapp");
    channels.push(
      new WhatsAppChannel({
        logger,
        authDir: Bun.env.WHATSAPP_AUTH_DIR,
      }),
    );
  }

  const gateway = new Gateway({
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
    configStore,
  }, db);

  await gateway.initStt();

  return gateway;
}
