import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Sidebar } from "./sidebar";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import type { ChatInputRecorderHandle } from "./chat-input";
import { StatusBar } from "./status-bar";
import { BrowserPreviewPanel } from "./browser-preview-panel";
import { Separator } from "../ui/separator";
import type { UseSpaceduckWs } from "../hooks/use-spaceduck-ws";

function getSttStatusUrl(): string {
  const stored = localStorage.getItem("spaceduck.gatewayUrl");
  if (stored) return `${stored}/api/stt/status`;
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return "http://localhost:3000/api/stt/status";
  }
  return `${window.location.origin}/api/stt/status`;
}

interface SttStatus {
  available: boolean;
  language?: string;
  maxSeconds?: number;
  maxBytes?: number;
  timeoutMs?: number;
}

interface ChatViewProps {
  ws: UseSpaceduckWs;
  onOpenSettings: () => void;
  onOpenTasks?: () => void;
  recorderRef?: React.MutableRefObject<ChatInputRecorderHandle | null>;
}

export function ChatView({ ws, onOpenSettings, onOpenTasks, recorderRef }: ChatViewProps) {
  const [stt, setStt] = useState<SttStatus>({ available: false });
  const toastDedupeRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    toastDedupeRef.current.clear();
  }, [ws.connectionEpoch]);

  useEffect(() => {
    for (const activity of ws.toolActivities) {
      if (!activity.result?.isError) continue;
      const fingerprint = `${activity.toolCallId}:${activity.toolName}:${activity.result.content.slice(0, 100)}`;
      if (toastDedupeRef.current.has(fingerprint)) continue;
      toastDedupeRef.current.add(fingerprint);
      const msg = activity.result.content.length > 120
        ? activity.result.content.slice(0, 120) + "…"
        : activity.result.content;
      toast.error(`${activity.toolName} failed`, { description: msg, duration: 6000 });
    }
  }, [ws.toolActivities]);

  useEffect(() => {
    let cancelled = false;
    fetch(getSttStatusUrl())
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setStt({
            available: !!data.available,
            language: data.language,
            maxSeconds: data.maxSeconds,
            maxBytes: data.maxBytes,
            timeoutMs: data.timeoutMs,
          });
        }
      })
      .catch(() => {
        // STT not available — leave default
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        conversations={ws.conversations}
        activeId={ws.activeConversationId}
        streamingIds={ws.streamingConversationIds}
        unreadIds={ws.unreadConversationIds}
        onSelect={ws.selectConversation}
        onCreate={() => ws.createConversation()}
        onDelete={ws.deleteConversation}
        onRename={ws.renameConversation}
        onOpenSettings={onOpenSettings}
        onOpenTasks={onOpenTasks}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-4 py-2">
          <h2 className="text-sm font-medium text-foreground truncate">
            {ws.activeConversationId
              ? ws.conversations.find((c) => c.id === ws.activeConversationId)?.title || "Untitled"
              : "New conversation"}
          </h2>
          <StatusBar status={ws.status} />
        </header>

        <Separator />

        <MessageList
          messages={ws.messages}
          pendingStream={ws.pendingStream}
          toolActivities={ws.toolActivities}
        />

        <ChatInput
          onSend={(content, attachments) => ws.sendMessage(content, ws.activeConversationId ?? undefined, attachments)}
          disabled={ws.status !== "connected"}
          isStreaming={ws.pendingStream !== null}
          sttAvailable={stt.available}
          sttLanguage={stt.language}
          sttMaxSeconds={stt.maxSeconds}
          recorderRef={recorderRef}
        />
      </main>

      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          ws.browserPreview ? "w-80" : "w-0"
        }`}
      >
        {ws.browserPreview && (
          <BrowserPreviewPanel preview={ws.browserPreview} />
        )}
      </div>
    </div>
  );
}
