// WebSocket handler: dispatches WsClientEnvelope messages to the appropriate handler

import type {
  WsClientEnvelope,
  WsServerEnvelope,
  Message,
  Logger,
  ConversationStore,
  SessionManager,
} from "@spaceduck/core";
import type { AgentLoop } from "@spaceduck/core";
import type { RunLock } from "./run-lock";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface WsHandlerDeps {
  readonly logger: Logger;
  readonly agent: AgentLoop;
  readonly conversationStore: ConversationStore;
  readonly sessionManager: SessionManager;
  readonly runLock: RunLock;
}

/** Per-connection state stored on ws.data */
export interface WsConnectionData {
  senderId: string;
  channelId: string;
  connectedAt: number;
}

function send(ws: { send(data: string): void }, envelope: WsServerEnvelope): void {
  ws.send(JSON.stringify(envelope));
}

function sendError(
  ws: { send(data: string): void },
  code: string,
  message: string,
): void {
  send(ws, { v: 1, type: "error", code, message });
}

/**
 * Parse and validate incoming WsClientEnvelope.
 * Returns null and sends error if invalid.
 */
function parseEnvelope(
  ws: { send(data: string): void },
  raw: string,
): WsClientEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendError(ws, "INVALID_JSON", "Message is not valid JSON");
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    sendError(ws, "INVALID_ENVELOPE", "Message must be a JSON object");
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.v !== 1) {
    sendError(ws, "UNSUPPORTED_VERSION", `Unsupported protocol version: ${obj.v}`);
    return null;
  }

  if (typeof obj.type !== "string") {
    sendError(ws, "MISSING_TYPE", "Message must have a 'type' field");
    return null;
  }

  return parsed as WsClientEnvelope;
}

/**
 * Create the WebSocket message handler.
 * Returns the handler function for use in Bun.serve websocket config.
 */
export function createWsHandler(deps: WsHandlerDeps) {
  const { logger, agent, conversationStore, sessionManager, runLock } = deps;
  const log = logger.child({ component: "WebSocket" });

  return {
    async message(ws: { send(data: string): void; data: WsConnectionData }, raw: string) {
      const envelope = parseEnvelope(ws, raw);
      if (!envelope) return;

      try {
        switch (envelope.type) {
          case "message.send":
            await handleMessageSend(ws, envelope);
            break;
          case "conversation.list":
            await handleConversationList(ws);
            break;
          case "conversation.history":
            await handleConversationHistory(ws, envelope);
            break;
          case "conversation.create":
            await handleConversationCreate(ws, envelope);
            break;
          case "conversation.delete":
            await handleConversationDelete(ws, envelope);
            break;
          default:
            sendError(ws, "UNKNOWN_TYPE", `Unknown message type: ${(envelope as { type: string }).type}`);
        }
      } catch (err) {
        log.error("Handler error", {
          type: envelope.type,
          error: String(err),
        });
        sendError(ws, "INTERNAL_ERROR", "An internal error occurred");
      }
    },

    open(ws: { send(data: string): void; data: WsConnectionData }) {
      log.debug("Client connected", { senderId: ws.data.senderId });
    },

    close(ws: { send(data: string): void; data: WsConnectionData }, code: number) {
      log.debug("Client disconnected", { senderId: ws.data.senderId, code });
    },
  };

  // --- Message handlers ---

  async function handleMessageSend(
    ws: { send(data: string): void; data: WsConnectionData },
    envelope: Extract<WsClientEnvelope, { type: "message.send" }>,
  ) {
    const { requestId, content, conversationId: requestedConvId } = envelope;

    if (!requestId || !content) {
      sendError(ws, "INVALID_REQUEST", "message.send requires requestId and content");
      return;
    }

    // Resolve session -> conversation
    const session = await sessionManager.resolve(ws.data.channelId, ws.data.senderId);
    const conversationId = requestedConvId || session.conversationId;

    // Ensure conversation exists
    const existing = await conversationStore.load(conversationId);
    if (!existing.ok) {
      send(ws, { v: 1, type: "stream.error", requestId, code: "MEMORY_ERROR", message: "Failed to load conversation" });
      return;
    }
    if (!existing.value) {
      await conversationStore.create(conversationId);
    }

    // Accept the message
    send(ws, { v: 1, type: "message.accepted", requestId, conversationId });

    // Acquire run lock
    const release = await runLock.acquire(conversationId);

    try {
      // Signal processing started
      send(ws, { v: 1, type: "processing.started", requestId });

      // Build user message
      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content,
        timestamp: Date.now(),
        requestId,
      };

      // Run agent and stream chunks (text deltas, tool calls, tool results)
      let responseMessageId = "";
      for await (const chunk of agent.run(conversationId, userMessage)) {
        switch (chunk.type) {
          case "text":
            send(ws, { v: 1, type: "stream.delta", requestId, delta: chunk.text });
            break;
          case "tool_call":
            send(ws, { v: 1, type: "tool.calling", requestId, toolCall: chunk.toolCall });
            break;
          case "tool_result":
            send(ws, { v: 1, type: "tool.result", requestId, toolResult: chunk.toolResult });
            break;
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

      send(ws, { v: 1, type: "stream.done", requestId, messageId: responseMessageId });
    } catch (err) {
      log.error("Agent run failed", { conversationId, requestId, error: String(err) });
      send(ws, {
        v: 1,
        type: "stream.error",
        requestId,
        code: "AGENT_ERROR",
        message: err instanceof Error ? err.message : "Agent run failed",
      });
    } finally {
      release();
    }
  }

  async function handleConversationList(ws: { send(data: string): void }) {
    const result = await conversationStore.list();
    if (!result.ok) {
      sendError(ws, "MEMORY_ERROR", result.error.message);
      return;
    }

    send(ws, {
      v: 1,
      type: "conversation.list",
      conversations: result.value.map((c) => ({
        id: c.id,
        title: c.title,
        lastActiveAt: c.lastActiveAt,
      })),
    });
  }

  async function handleConversationHistory(
    ws: { send(data: string): void },
    envelope: Extract<WsClientEnvelope, { type: "conversation.history" }>,
  ) {
    const { conversationId } = envelope;
    if (!conversationId) {
      sendError(ws, "INVALID_REQUEST", "conversation.history requires conversationId");
      return;
    }

    const result = await conversationStore.loadMessages(conversationId);
    if (!result.ok) {
      sendError(ws, "MEMORY_ERROR", result.error.message);
      return;
    }

    send(ws, {
      v: 1,
      type: "conversation.history",
      conversationId,
      messages: result.value.filter((m) => m.role === "user" || (m.role === "assistant" && m.content)),
    });
  }

  async function handleConversationCreate(
    ws: { send(data: string): void },
    envelope: Extract<WsClientEnvelope, { type: "conversation.create" }>,
  ) {
    const id = generateId();
    const result = await conversationStore.create(id, envelope.title);
    if (!result.ok) {
      sendError(ws, "MEMORY_ERROR", result.error.message);
      return;
    }

    send(ws, { v: 1, type: "conversation.created", conversationId: id });
  }

  async function handleConversationDelete(
    ws: { send(data: string): void },
    envelope: Extract<WsClientEnvelope, { type: "conversation.delete" }>,
  ) {
    const { conversationId } = envelope;
    if (!conversationId) {
      sendError(ws, "INVALID_REQUEST", "conversation.delete requires conversationId");
      return;
    }

    const result = await conversationStore.delete(conversationId);
    if (!result.ok) {
      sendError(ws, "MEMORY_ERROR", result.error.message);
      return;
    }

    send(ws, { v: 1, type: "conversation.deleted", conversationId });
  }
}
