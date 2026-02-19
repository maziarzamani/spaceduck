// WhatsApp channel via Baileys (WhatsApp Web protocol)
// Implements the Channel interface — scan a QR code and go.

import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
  type WAMessageKey,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import type {
  Channel,
  ChannelMessage,
  ChannelResponse,
  LifecycleStatus,
  Logger,
} from "@spaceduck/core";
import { ChannelError } from "@spaceduck/core";
import qrcode from "qrcode-terminal";
import { join } from "path";
import { mkdirSync } from "fs";

export interface WhatsAppChannelOptions {
  /** Directory to store auth credentials. Defaults to data/whatsapp-auth */
  readonly authDir?: string;
  /** Logger instance */
  readonly logger: Logger;
}

/**
 * WhatsApp channel using Baileys (WhatsApp Web multi-device protocol).
 *
 * On first start, prints a QR code to the terminal — scan it with WhatsApp
 * on your phone. Auth state is persisted so subsequent starts reconnect
 * automatically.
 */
export class WhatsAppChannel implements Channel {
  readonly name = "whatsapp";

  private _status: LifecycleStatus = "stopped";
  private sock: WASocket | null = null;
  private messageHandler: ((msg: ChannelMessage) => Promise<void>) | null = null;
  private readonly authDir: string;
  private readonly logger: Logger;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly baseReconnectMs = 3000;

  // Buffer streamed deltas per (senderId, requestId) so we can send a
  // single WhatsApp message when the stream completes.
  private responseBuffers = new Map<string, string>();

  // Track message IDs sent by the bot so we can ignore them on upsert
  // (prevents infinite loops when chatting with yourself).
  private sentMessageIds = new Set<string>();

  constructor(options: WhatsAppChannelOptions) {
    this.authDir = options.authDir ?? join("data", "whatsapp-auth");
    this.logger = options.logger;
  }

  get status(): LifecycleStatus {
    return this._status;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._status === "running" || this._status === "starting") return;
    this._status = "starting";

    mkdirSync(this.authDir, { recursive: true });

    await this.connect();
  }

  async stop(): Promise<void> {
    if (this._status === "stopped" || this._status === "stopping") return;
    this._status = "stopping";

    this.sock?.end(undefined);
    this.sock = null;
    this.responseBuffers.clear();
    this.sentMessageIds.clear();

    this.logger.info("WhatsApp channel stopped");
    this._status = "stopped";
  }

  // ── Channel contract ───────────────────────────────────────────────

  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendText(senderId: string, text: string, _response: ChannelResponse): Promise<void> {
    await this.send(senderId, text);
  }

  // Track last composing refresh to avoid spamming presence updates
  private lastComposingRefresh = 0;

  async sendDelta(senderId: string, delta: string, response: ChannelResponse): Promise<void> {
    // WhatsApp can't edit messages in-flight — buffer the text until sendDone
    const key = `${senderId}:${response.requestId}`;
    const existing = this.responseBuffers.get(key) ?? "";
    this.responseBuffers.set(key, existing + delta);

    // Refresh composing indicator every 10s to prevent it from expiring
    const now = Date.now();
    if (now - this.lastComposingRefresh > 10_000) {
      this.lastComposingRefresh = now;
      await this.setPresence(senderId, "composing");
    }
  }

  async sendDone(senderId: string, _messageId: string, response: ChannelResponse): Promise<void> {
    const key = `${senderId}:${response.requestId}`;
    let fullText = this.responseBuffers.get(key);
    this.responseBuffers.delete(key);

    if (fullText) {
      // Strip LLM thinking tags (e.g. Qwen3 <think>...</think>) and trim whitespace
      fullText = fullText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      // Collapse 3+ consecutive newlines into 2
      fullText = fullText.replace(/\n{3,}/g, "\n\n");

      if (fullText) {
        await this.send(senderId, fullText);
      }
    }

    // Stop typing indicator
    await this.setPresence(senderId, "paused");
  }

  async sendError(senderId: string, _code: string, message: string, response: ChannelResponse): Promise<void> {
    // Clean up any buffered response
    this.responseBuffers.delete(`${senderId}:${response.requestId}`);
    await this.send(senderId, `Error: ${message}`);
    await this.setPresence(senderId, "paused");
  }

  // ── Typing indicator (called by gateway before processing) ─────────

  async setPresence(senderId: string, presence: "composing" | "paused"): Promise<void> {
    if (!this.sock) return;
    try {
      // Presence updates require the phone-number JID (@s.whatsapp.net),
      // not the LID format. Normalize if needed.
      const jid = this.toPhoneJid(senderId);
      await this.sock.sendPresenceUpdate(presence, jid);
    } catch {
      // Best-effort — don't crash if presence update fails
    }
  }

  /** Convert a LID jid to phone-number jid if possible, otherwise return as-is. */
  private toPhoneJid(jid: string): string {
    if (!jid.endsWith("@lid")) return jid;
    const ownJid = this.sock?.user?.id;
    const ownLid = (this.sock?.user as any)?.lid;
    if (!ownJid || !ownLid) return jid;
    const lidNumber = ownLid.split(":")[0];
    if (jid === lidNumber + "@lid") {
      return ownJid.split(":")[0] + "@s.whatsapp.net";
    }
    return jid;
  }

  // ── Internals ──────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    // Close any existing socket to prevent multiple concurrent connections
    if (this.sock) {
      try { this.sock.end(undefined); } catch { /* best effort */ }
      this.sock = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, undefined as any),
      },
      printQRInTerminal: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (_key: WAMessageKey) => proto.Message.create({}),
    });

    this.sock.ev.process(async (events) => {
      // Connection state changes
      if (events["connection.update"]) {
        const { connection, lastDisconnect, qr } = events["connection.update"];

        if (qr) {
          this.logger.info("Scan the QR code below with WhatsApp on your phone:");
          qrcode.generate(qr, { small: true });
        }

        if (connection === "open") {
          this._status = "running";
          this.reconnecting = false;
          this.reconnectAttempts = 0;
          this.logger.info("WhatsApp channel connected");
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

          if (statusCode === DisconnectReason.loggedOut) {
            this.logger.error("WhatsApp logged out — delete auth dir and restart to re-pair");
            this._status = "stopped";
            return;
          }

          // Status 440 = conflict: replaced — another session took over.
          // Back off aggressively to avoid a reconnect storm.
          if (statusCode === 440) {
            this.reconnectAttempts++;
            if (this.reconnectAttempts > this.maxReconnectAttempts) {
              this.logger.error("WhatsApp: too many conflict:replaced errors, giving up. Another session may be active.");
              this._status = "stopped";
              return;
            }
            const delay = this.baseReconnectMs * Math.pow(2, this.reconnectAttempts);
            this.logger.warn(`WhatsApp conflict:replaced — attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}, retrying in ${delay}ms`);
            this.reconnecting = true;
            setTimeout(() => this.connect(), delay);
            return;
          }

          // Reconnect on other transient failures
          if (!this.reconnecting && this._status !== "stopping") {
            this.reconnecting = true;
            this.reconnectAttempts++;
            const delay = Math.min(this.baseReconnectMs * Math.pow(2, this.reconnectAttempts - 1), 30_000);
            this.logger.warn("WhatsApp disconnected, reconnecting...", {
              statusCode,
              attempt: this.reconnectAttempts,
              delayMs: delay,
            });
            setTimeout(() => this.connect(), delay);
          }
        }
      }

      // Persist auth credentials
      if (events["creds.update"]) {
        await saveCreds();
      }

      // Incoming messages
      if (events["messages.upsert"]) {
        const { messages, type } = events["messages.upsert"];
        if (type !== "notify") return;

        for (const msg of messages) {
          await this.handleIncoming(msg);
        }
      }
    });
  }

  private async handleIncoming(msg: proto.IWebMessageInfo): Promise<void> {
    if (!msg.key) return;
    const msgId = msg.key.id;

    // Skip messages the bot itself sent (prevents infinite loops)
    if (msgId && this.sentMessageIds.has(msgId)) {
      this.sentMessageIds.delete(msgId);
      return;
    }

    // Only respond to messages the user typed themselves (fromMe),
    // ignore messages from other people.
    if (!msg.key.fromMe) return;

    // Skip group messages, broadcasts, newsletters, status
    const jid = msg.key.remoteJid;
    if (!jid) return;
    if (isJidGroup(jid)) return;
    if (isJidBroadcast(jid)) return;
    if (isJidNewsletter(jid)) return;
    if (isJidStatusBroadcast(jid)) return;

    // Only respond in self-chat (messaging yourself), not when you
    // message other people.
    const ownJid = this.sock?.user?.id;
    if (!ownJid) return;
    const ownNumber = ownJid.split(":")[0] + "@s.whatsapp.net";
    const ownLid = (this.sock?.user as any)?.lid;
    const ownLidNormalized = ownLid ? ownLid.split(":")[0] + "@lid" : null;
    if (jid !== ownNumber && jid !== ownLidNormalized) return;

    // Extract text content
    const text =
      msg.message?.conversation ??
      msg.message?.extendedTextMessage?.text;
    if (!text) return;

    if (!this.messageHandler) {
      this.logger.warn("WhatsApp message received but no handler registered");
      return;
    }

    const channelMessage: ChannelMessage = {
      channelId: "whatsapp",
      senderId: jid,
      content: text,
      requestId: msg.key.id ?? `wa-${Date.now().toString(36)}`,
    };

    // Show typing before processing
    await this.setPresence(jid, "composing");

    try {
      await this.messageHandler(channelMessage);
    } catch (error) {
      this.logger.error("Error handling WhatsApp message", {
        error: error instanceof Error ? error.message : String(error),
        senderId: jid,
      });
      await this.send(jid, "Sorry, something went wrong processing your message.");
      await this.setPresence(jid, "paused");
    }
  }

  private async send(jid: string, text: string): Promise<void> {
    if (!this.sock) {
      throw new ChannelError("WhatsApp socket not connected");
    }

    const phoneJid = this.toPhoneJid(jid);
    const sent = await this.sock.sendMessage(phoneJid, { text });
    if (sent?.key?.id) {
      this.sentMessageIds.add(sent.key.id);
    }
  }
}
