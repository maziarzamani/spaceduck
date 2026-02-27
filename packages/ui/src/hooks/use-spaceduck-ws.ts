import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WsClientEnvelope,
  WsServerEnvelope,
  ConversationSummary,
  Message,
  Attachment,
} from "@spaceduck/core";
import type { ToolActivity } from "../lib/tool-types";
import { createWebSocket, WS_OPEN, type UnifiedWs } from "../lib/ws-adapter";

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
const RECONNECT_MAX_MS = 8000;
const AUTH_CHECK_AFTER_RETRIES = 5;

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface PendingStream {
  requestId: string;
  conversationId: string;
  content: string;
}

export interface BrowserPreview {
  dataUrl: string;
  url: string;
  timestamp: number;
}

export interface UseSpaceduckWs {
  status: ConnectionStatus;
  authFailed: boolean;
  conversations: ConversationSummary[];
  messages: Message[];
  activeConversationId: string | null;
  pendingStream: PendingStream | null;
  streamingConversationIds: ReadonlySet<string>;
  unreadConversationIds: ReadonlySet<string>;
  toolActivities: ToolActivity[];
  connectionEpoch: number;
  browserPreview: BrowserPreview | null;
  sendMessage: (content: string, conversationId?: string, attachments?: Attachment[]) => string;
  createConversation: (title?: string) => void;
  deleteConversation: (conversationId: string) => void;
  renameConversation: (conversationId: string, title: string) => void;
  selectConversation: (conversationId: string) => void;
  refreshConversations: () => void;
}

interface ConversationStreamState {
  pendingStream: PendingStream | null;
  streamBuffer: string;
  toolActivities: ToolActivity[];
  browserPreview: BrowserPreview | null;
}

function emptyStreamState(): ConversationStreamState {
  return { pendingStream: null, streamBuffer: "", toolActivities: [], browserPreview: null };
}

export function useSpaceduckWs(enabled = true): UseSpaceduckWs {
  const wsRef = useRef<UnifiedWs | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [authFailed, setAuthFailed] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [pendingStream, setPendingStream] = useState<PendingStream | null>(null);
  const [streamingConversationIds, setStreamingConversationIds] = useState<Set<string>>(new Set());
  const [unreadConversationIds, setUnreadConversationIds] = useState<Set<string>>(new Set());
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [browserPreview, setBrowserPreview] = useState<BrowserPreview | null>(null);

  const retriesRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const activeConvIdRef = useRef<string | null>(null);
  const pendingConvIdRef = useRef<string | null>(null);
  const handleMessageRef = useRef<(envelope: WsServerEnvelope) => void>(() => {});

  const streamStateMap = useRef<Map<string, ConversationStreamState>>(new Map());

  activeConvIdRef.current = activeConversationId;

  function getStreamState(convId: string): ConversationStreamState {
    let s = streamStateMap.current.get(convId);
    if (!s) {
      s = emptyStreamState();
      streamStateMap.current.set(convId, s);
    }
    return s;
  }

  function projectViewState(convId: string | null) {
    if (!convId || !streamStateMap.current.has(convId)) {
      setPendingStream(null);
      setToolActivities([]);
      setBrowserPreview(null);
      return;
    }
    const s = streamStateMap.current.get(convId)!;
    setPendingStream(s.pendingStream);
    setToolActivities([...s.toolActivities]);
    setBrowserPreview(s.browserPreview);
  }

  const send = useCallback((envelope: WsClientEnvelope) => {
    if (wsRef.current?.readyState === WS_OPEN) {
      wsRef.current.send(JSON.stringify(envelope));
    }
  }, []);

  const connect = useCallback(async () => {
    if (unmountedRef.current) return;

    const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl");
    const token = localStorage.getItem("spaceduck.token");

    // After several failed retries, check if the token is permanently invalid.
    // We only do this when the gateway is reachable but WS keeps failing,
    // which signals a potential auth problem rather than a transient outage.
    if (retriesRef.current >= AUTH_CHECK_AFTER_RETRIES && gatewayUrl) {
      try {
        if (token) {
          const res = await fetch(`${gatewayUrl}/api/gateway/info`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(3000),
          });
          if (res.status === 401) {
            setAuthFailed(true);
            return;
          }
        } else {
          const res = await fetch(`${gatewayUrl}/api/gateway/public-info`, {
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            const info = await res.json() as { requiresAuth?: boolean };
            if (info.requiresAuth) {
              setAuthFailed(true);
              return;
            }
          }
        }
      } catch {
        // Gateway unreachable — keep retrying WS
      }
    }

    const wsUrl = getWsUrl();
    setStatus("connecting");

    const ws = await createWebSocket(wsUrl, {
      onopen: () => {
        retriesRef.current = 0;
        setStatus("connected");
        setConnectionEpoch((prev) => prev + 1);
        setToolActivities([]);
        send({ v: 1, type: "conversation.list" });
      },
      onclose: () => {
        if (unmountedRef.current) return;
        setStatus("disconnected");
        wsRef.current = null;

        const delay = Math.min(
          RECONNECT_BASE_MS * Math.pow(2, retriesRef.current),
          RECONNECT_MAX_MS,
        );
        retriesRef.current++;
        reconnectTimerRef.current = setTimeout(connect, delay);
      },
      onerror: () => {
        // onclose will fire after onerror, which triggers reconnect
      },
      onmessage: (data) => {
        try {
          const envelope = JSON.parse(data) as WsServerEnvelope;
          handleMessageRef.current(envelope);
        } catch {
          // Ignore malformed messages
        }
      },
    });
    wsRef.current = ws;
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
        projectViewState(envelope.conversationId);
        send({ v: 1, type: "conversation.list" });
        break;

      case "conversation.deleted":
        setConversations((prev) => prev.filter((c) => c.id !== envelope.conversationId));
        streamStateMap.current.delete(envelope.conversationId);
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
        pendingConvIdRef.current = envelope.conversationId;
        if (!activeConvIdRef.current) {
          setActiveConversationId(envelope.conversationId);
        }
        break;

      case "processing.started": {
        const convId = pendingConvIdRef.current || activeConvIdRef.current || "";
        const s = getStreamState(convId);
        s.streamBuffer = "";
        s.pendingStream = {
          requestId: envelope.requestId,
          conversationId: convId,
          content: "",
        };
        s.toolActivities = [];
        s.browserPreview = null;
        setStreamingConversationIds((prev) => new Set(prev).add(convId));
        if (convId === activeConvIdRef.current) {
          projectViewState(convId);
        }
        break;
      }

      case "stream.delta": {
        const convId = pendingConvIdRef.current;
        if (!convId) break;
        const s = getStreamState(convId);
        s.streamBuffer += envelope.delta;
        if (s.pendingStream) {
          s.pendingStream = { ...s.pendingStream, content: s.streamBuffer };
        }
        if (convId === activeConvIdRef.current) {
          setPendingStream(s.pendingStream);
        }
        break;
      }

      case "stream.done": {
        const finishedConvId = pendingConvIdRef.current;
        if (finishedConvId && finishedConvId !== activeConvIdRef.current) {
          setUnreadConversationIds((prev) => new Set(prev).add(finishedConvId));
        }
        if (finishedConvId) {
          streamStateMap.current.delete(finishedConvId);
        }
        setStreamingConversationIds((prev) => {
          if (!finishedConvId || !prev.has(finishedConvId)) return prev;
          const next = new Set(prev);
          next.delete(finishedConvId);
          return next;
        });
        pendingConvIdRef.current = null;
        if (finishedConvId === activeConvIdRef.current || !finishedConvId) {
          setPendingStream(null);
          setToolActivities([]);
          setBrowserPreview(null);
        }
        if (activeConvIdRef.current) {
          send({ v: 1, type: "conversation.history", conversationId: activeConvIdRef.current });
        }
        send({ v: 1, type: "conversation.list" });
        break;
      }

      case "stream.error": {
        const errorConvId = pendingConvIdRef.current;
        if (errorConvId) {
          streamStateMap.current.delete(errorConvId);
        }
        setStreamingConversationIds((prev) => {
          if (!errorConvId || !prev.has(errorConvId)) return prev;
          const next = new Set(prev);
          next.delete(errorConvId);
          return next;
        });
        pendingConvIdRef.current = null;
        if (errorConvId === activeConvIdRef.current || !errorConvId) {
          setPendingStream(null);
          setToolActivities([]);
          setBrowserPreview(null);
        }
        break;
      }

      case "tool.calling": {
        const convId = pendingConvIdRef.current;
        if (!convId) break;
        const s = getStreamState(convId);
        const activity: ToolActivity = {
          toolCallId: envelope.toolCall.id,
          toolName: envelope.toolCall.name,
          startedAt: Date.now(),
        };
        s.toolActivities = [...s.toolActivities, activity];
        if (s.toolActivities.length > 20) {
          s.toolActivities = s.toolActivities.slice(-20);
        }
        if (convId === activeConvIdRef.current) {
          setToolActivities([...s.toolActivities]);
        }
        break;
      }

      case "tool.result": {
        const convId = pendingConvIdRef.current;
        if (!convId) break;
        const s = getStreamState(convId);
        s.toolActivities = s.toolActivities.map((a) =>
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
        );
        if (convId === activeConvIdRef.current) {
          setToolActivities([...s.toolActivities]);
        }
        break;
      }

      case "browser.frame": {
        const convId = pendingConvIdRef.current;
        if (!convId) break;
        const s = getStreamState(convId);
        if ("closed" in envelope && envelope.closed) {
          s.browserPreview = null;
        } else if ("data" in envelope) {
          s.browserPreview = {
            dataUrl: `data:image/${envelope.format};base64,${envelope.data}`,
            url: envelope.url,
            timestamp: Date.now(),
          };
        }
        if (convId === activeConvIdRef.current) {
          setBrowserPreview(s.browserPreview);
        }
        break;
      }

      case "run.active": {
        const ids = envelope.conversationIds;
        setStreamingConversationIds(new Set(ids));
        for (const id of ids) {
          const s = getStreamState(id);
          if (!s.pendingStream) {
            s.pendingStream = { requestId: "", conversationId: id, content: "" };
          }
        }
        if (activeConvIdRef.current && ids.includes(activeConvIdRef.current)) {
          projectViewState(activeConvIdRef.current);
        }
        break;
      }

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
      streamStateMap.current.delete(conversationId);
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
      projectViewState(conversationId);
      setUnreadConversationIds((prev) => {
        if (!prev.has(conversationId)) return prev;
        const next = new Set(prev);
        next.delete(conversationId);
        return next;
      });
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
    streamingConversationIds,
    unreadConversationIds,
    toolActivities,
    connectionEpoch,
    browserPreview,
    sendMessage,
    createConversation,
    deleteConversation,
    renameConversation,
    selectConversation,
    refreshConversations,
  };
}
