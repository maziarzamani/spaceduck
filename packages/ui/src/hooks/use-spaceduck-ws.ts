import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WsClientEnvelope,
  WsServerEnvelope,
  ConversationSummary,
  Message,
  Attachment,
} from "@spaceduck/core";

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

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface PendingStream {
  requestId: string;
  conversationId: string;
  content: string;
}

export interface UseSpaceduckWs {
  status: ConnectionStatus;
  conversations: ConversationSummary[];
  messages: Message[];
  activeConversationId: string | null;
  pendingStream: PendingStream | null;
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
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [pendingStream, setPendingStream] = useState<PendingStream | null>(null);

  const streamBufferRef = useRef<string>("");
  const retriesRef = useRef(0);
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

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    const wsUrl = getWsUrl();
    setStatus("connecting");

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      retriesRef.current = 0;
      setStatus("connected");
      send({ v: 1, type: "conversation.list" });
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      setStatus("disconnected");
      wsRef.current = null;

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
        const finalContent = streamBufferRef.current;
        setPendingStream(null);
        streamBufferRef.current = "";
        setMessages((prev) => [
          ...prev,
          {
            id: envelope.messageId,
            role: "assistant" as const,
            content: finalContent,
            timestamp: Date.now(),
          },
        ]);
        send({ v: 1, type: "conversation.list" });
        break;
      }

      case "stream.error":
        setPendingStream(null);
        streamBufferRef.current = "";
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
    conversations,
    messages,
    activeConversationId,
    pendingStream,
    sendMessage,
    createConversation,
    deleteConversation,
    renameConversation,
    selectConversation,
    refreshConversations,
  };
}
