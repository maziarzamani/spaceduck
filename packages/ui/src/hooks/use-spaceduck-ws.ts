import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WsClientEnvelope,
  WsServerEnvelope,
  ConversationSummary,
  Message,
  Attachment,
} from "@spaceduck/core";
import type { ToolActivity } from "../lib/tool-types";

function getWsUrl(): string {
  const stored = localStorage.getItem("spaceduck.gatewayUrl");
  const token = localStorage.getItem("spaceduck.token");

  let base: string;
  if (stored) {
    const parsed = new URL(stored);
    const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    base = `${protocol}//${parsed.host}/ws`;
  } else if (typeof window !== "undefined" && "__TAURI__" in window) {
    base = "ws://localhost:3000/ws";
  } else {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    base = `${protocol}//${window.location.host}/ws`;
  }

  if (token) {
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}token=${encodeURIComponent(token)}`;
  }
  return base;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const AUTH_FAILURE_THRESHOLD = 3;

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface PendingStream {
  requestId: string;
  conversationId: string;
  content: string;
}

export interface UseSpaceduckWs {
  status: ConnectionStatus;
  authFailed: boolean;
  conversations: ConversationSummary[];
  messages: Message[];
  activeConversationId: string | null;
  pendingStream: PendingStream | null;
  toolActivities: ToolActivity[];
  connectionEpoch: number;
  sendMessage: (content: string, conversationId?: string, attachments?: Attachment[]) => string;
  createConversation: (title?: string) => void;
  deleteConversation: (conversationId: string) => void;
  renameConversation: (conversationId: string, title: string) => void;
  selectConversation: (conversationId: string) => void;
  refreshConversations: () => void;
}

export function useSpaceduckWs(enabled = true): UseSpaceduckWs {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [authFailed, setAuthFailed] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [pendingStream, setPendingStream] = useState<PendingStream | null>(null);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [connectionEpoch, setConnectionEpoch] = useState(0);

  const streamBufferRef = useRef<string>("");
  const retriesRef = useRef(0);
  const consecutiveFailsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const activeConvIdRef = useRef<string | null>(null);
  const handleMessageRef = useRef<(envelope: WsServerEnvelope) => void>(() => {});

  activeConvIdRef.current = activeConversationId;

  const send = useCallback((envelope: WsClientEnvelope) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(envelope));
    }
  }, []);

  const connect = useCallback(async () => {
    if (unmountedRef.current) return;

    const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl");
    const token = localStorage.getItem("spaceduck.token");
    if (gatewayUrl && token) {
      try {
        const res = await fetch(`${gatewayUrl}/api/gateway/info`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (res.status === 401) {
          setAuthFailed(true);
          return;
        }
      } catch {
        // Gateway unreachable — fall through and try WebSocket anyway
      }
    }

    const wsUrl = getWsUrl();
    setStatus("connecting");

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      retriesRef.current = 0;
      consecutiveFailsRef.current = 0;
      setStatus("connected");
      setConnectionEpoch((prev) => prev + 1);
      setToolActivities([]);
      send({ v: 1, type: "conversation.list" });
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      setStatus("disconnected");
      wsRef.current = null;

      consecutiveFailsRef.current++;
      if (consecutiveFailsRef.current >= AUTH_FAILURE_THRESHOLD && token) {
        setAuthFailed(true);
        return;
      }

      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, retriesRef.current),
        RECONNECT_MAX_MS,
      );
      retriesRef.current++;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose will fire after onerror, which triggers reconnect
    };

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data) as WsServerEnvelope;
        handleMessageRef.current(envelope);
      } catch {
        // Ignore malformed messages
      }
    };
  }, [send]);

  useEffect(() => {
    unmountedRef.current = false;

    if (!enabled) {
      setStatus("disconnected");
      return;
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      retriesRef.current = 0;
    };
  }, [connect, enabled]);

  function handleServerMessage(envelope: WsServerEnvelope) {
    switch (envelope.type) {
      case "conversation.list":
        setConversations(envelope.conversations);
        break;

      case "conversation.created":
        setActiveConversationId(envelope.conversationId);
        setMessages([]);
        send({ v: 1, type: "conversation.list" });
        break;

      case "conversation.deleted":
        setConversations((prev) => prev.filter((c) => c.id !== envelope.conversationId));
        if (activeConvIdRef.current === envelope.conversationId) {
          setActiveConversationId(null);
          setMessages([]);
        }
        break;

      case "conversation.renamed":
        setConversations((prev) =>
          prev.map((c) =>
            c.id === envelope.conversationId ? { ...c, title: envelope.title } : c,
          ),
        );
        break;

      case "conversation.history":
        setMessages(envelope.messages);
        break;

      case "message.accepted":
        if (!activeConvIdRef.current) {
          setActiveConversationId(envelope.conversationId);
        }
        break;

      case "processing.started":
        streamBufferRef.current = "";
        setPendingStream({
          requestId: envelope.requestId,
          conversationId: activeConvIdRef.current || "",
          content: "",
        });
        break;

      case "stream.delta":
        streamBufferRef.current += envelope.delta;
        setPendingStream((prev) =>
          prev ? { ...prev, content: streamBufferRef.current } : null,
        );
        break;

      case "stream.done": {
        setPendingStream(null);
        streamBufferRef.current = "";
        setToolActivities([]);
        if (activeConvIdRef.current) {
          send({ v: 1, type: "conversation.history", conversationId: activeConvIdRef.current });
        }
        send({ v: 1, type: "conversation.list" });
        break;
      }

      case "stream.error":
        setPendingStream(null);
        streamBufferRef.current = "";
        setToolActivities([]);
        break;

      case "tool.calling":
        setToolActivities((prev) => {
          const activity: ToolActivity = {
            toolCallId: envelope.toolCall.id,
            toolName: envelope.toolCall.name,
            startedAt: Date.now(),
          };
          const next = [...prev, activity];
          return next.length > 20 ? next.slice(-20) : next;
        });
        break;

      case "tool.result":
        setToolActivities((prev) =>
          prev.map((a) =>
            a.toolCallId === envelope.toolResult.toolCallId
              ? {
                  ...a,
                  result: {
                    content: envelope.toolResult.content,
                    isError: !!envelope.toolResult.isError,
                  },
                  completedAt: Date.now(),
                }
              : a,
          ),
        );
        break;

      case "error":
        console.error("[spaceduck ws]", envelope.code, envelope.message);
        break;
    }
  }
  handleMessageRef.current = handleServerMessage;

  const sendMessage = useCallback(
    (content: string, conversationId?: string, attachments?: Attachment[]): string => {
      const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const convId = conversationId || activeConvIdRef.current || undefined;

      const userMsg: Message = {
        id: `local-${requestId}`,
        role: "user",
        content,
        timestamp: Date.now(),
        requestId,
        attachments: attachments?.length ? attachments : undefined,
      };
      setMessages((prev) => [...prev, userMsg]);

      send({
        v: 1,
        type: "message.send",
        requestId,
        conversationId: convId,
        content,
        attachments: attachments?.length ? attachments : undefined,
      });
      return requestId;
    },
    [send],
  );

  const createConversation = useCallback(
    (title?: string) => {
      send({ v: 1, type: "conversation.create", title });
    },
    [send],
  );

  const deleteConversation = useCallback(
    (conversationId: string) => {
      send({ v: 1, type: "conversation.delete", conversationId });
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (activeConvIdRef.current === conversationId) {
        setActiveConversationId(null);
        setMessages([]);
      }
    },
    [send],
  );

  const renameConversation = useCallback(
    (conversationId: string, title: string) => {
      send({ v: 1, type: "conversation.rename", conversationId, title });
    },
    [send],
  );

  const selectConversation = useCallback(
    (conversationId: string) => {
      setActiveConversationId(conversationId);
      setMessages([]);
      send({ v: 1, type: "conversation.history", conversationId });
    },
    [send],
  );

  const refreshConversations = useCallback(() => {
    send({ v: 1, type: "conversation.list" });
  }, [send]);

  return {
    status,
    authFailed,
    conversations,
    messages,
    activeConversationId,
    pendingStream,
    toolActivities,
    connectionEpoch,
    sendMessage,
    createConversation,
    deleteConversation,
    renameConversation,
    selectConversation,
    refreshConversations,
  };
}
