import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WsClientEnvelope,
  WsServerEnvelope,
  ConversationSummary,
  Message,
} from "@spaceduck/core";

function getWsUrl(): string {
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return "ws://localhost:3000/ws";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

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
  sendMessage: (content: string, conversationId?: string) => string;
  createConversation: (title?: string) => void;
  deleteConversation: (conversationId: string) => void;
  selectConversation: (conversationId: string) => void;
  refreshConversations: () => void;
}

export function useSpaceduckWs(): UseSpaceduckWs {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [pendingStream, setPendingStream] = useState<PendingStream | null>(null);

  const streamBufferRef = useRef<string>("");

  const send = useCallback((envelope: WsClientEnvelope) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(envelope));
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    const wsUrl = getWsUrl();

    setStatus("connecting");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      // Request conversation list on connect
      send({ v: 1, type: "conversation.list" });
    };

    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;
    };

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data) as WsServerEnvelope;
        handleServerMessage(envelope);
      } catch {
        // Ignore malformed messages
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  function handleServerMessage(envelope: WsServerEnvelope) {
    switch (envelope.type) {
      case "conversation.list":
        setConversations(envelope.conversations);
        break;

      case "conversation.created":
        setActiveConversationId(envelope.conversationId);
        setMessages([]);
        // Refresh list
        send({ v: 1, type: "conversation.list" });
        break;

      case "conversation.deleted":
        setConversations((prev) => prev.filter((c) => c.id !== envelope.conversationId));
        if (activeConversationId === envelope.conversationId) {
          setActiveConversationId(null);
          setMessages([]);
        }
        break;

      case "conversation.history":
        setMessages(envelope.messages);
        break;

      case "message.accepted":
        // Auto-set active conversation if not set
        if (!activeConversationId) {
          setActiveConversationId(envelope.conversationId);
        }
        break;

      case "processing.started":
        streamBufferRef.current = "";
        setPendingStream({
          requestId: envelope.requestId,
          conversationId: activeConversationId || "",
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
        // Add the completed assistant message to local state
        setMessages((prev) => [
          ...prev,
          {
            id: envelope.messageId,
            role: "assistant" as const,
            content: finalContent,
            timestamp: Date.now(),
          },
        ]);
        // Refresh conversations to update lastActiveAt / titles
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

  const sendMessage = useCallback(
    (content: string, conversationId?: string): string => {
      const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const convId = conversationId || activeConversationId || undefined;

      // Optimistically add user message
      const userMsg: Message = {
        id: `local-${requestId}`,
        role: "user",
        content,
        timestamp: Date.now(),
        requestId,
      };
      setMessages((prev) => [...prev, userMsg]);

      send({ v: 1, type: "message.send", requestId, conversationId: convId, content });
      return requestId;
    },
    [activeConversationId, send],
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
    selectConversation,
    refreshConversations,
  };
}
