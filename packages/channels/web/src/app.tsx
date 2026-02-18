import { useSpaceduckWs } from "./hooks/use-spaceduck-ws";
import { Sidebar } from "./components/sidebar";
import { MessageList } from "./components/message-list";
import { ChatInput } from "./components/chat-input";
import { StatusBar } from "./components/status-bar";

export function App() {
  const ws = useSpaceduckWs();

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        conversations={ws.conversations}
        activeId={ws.activeConversationId}
        onSelect={ws.selectConversation}
        onCreate={() => ws.createConversation()}
        onDelete={ws.deleteConversation}
      />

      {/* Main chat area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 className="text-sm font-medium text-foreground truncate">
            {ws.activeConversationId
              ? ws.conversations.find((c) => c.id === ws.activeConversationId)?.title || "Untitled"
              : "New conversation"}
          </h2>
          <StatusBar status={ws.status} />
        </header>

        {/* Messages */}
        <MessageList
          messages={ws.messages}
          pendingStream={ws.pendingStream}
        />

        {/* Input */}
        <ChatInput
          onSend={(content) => ws.sendMessage(content, ws.activeConversationId ?? undefined)}
          disabled={ws.status !== "connected"}
          isStreaming={ws.pendingStream !== null}
        />
      </main>
    </div>
  );
}
