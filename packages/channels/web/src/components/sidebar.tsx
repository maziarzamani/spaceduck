import { cn } from "../lib/utils";
import type { ConversationSummary } from "@spaceduck/core";
import { MessageSquarePlus, Trash2, MessageCircle } from "lucide-react";
import { SpaceduckLogo } from "./spaceduck-logo";

interface SidebarProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function Sidebar({ conversations, activeId, onSelect, onCreate, onDelete }: SidebarProps) {
  return (
    <aside className="flex flex-col w-64 h-full bg-card border-r border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <SpaceduckLogo size={28} />
          <h1 className="text-sm font-semibold tracking-tight">spaceduck</h1>
        </div>
        <button
          onClick={onCreate}
          className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="New conversation"
        >
          <MessageSquarePlus size={18} />
        </button>
      </div>

      {/* Conversation list */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {conversations.length === 0 && (
          <p className="text-xs text-muted-foreground text-center mt-8 px-4">
            No conversations yet. Start a new one!
          </p>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={cn(
              "group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors mb-0.5",
              activeId === conv.id
                ? "bg-primary/15 text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => onSelect(conv.id)}
          >
            <MessageCircle size={14} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">
                {conv.title || "Untitled"}
              </p>
              <p className="text-xs text-muted-foreground">
                {timeAgo(conv.lastActiveAt)}
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(conv.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <p className="text-xs text-muted-foreground">
          spaceduck v0.1.0
        </p>
      </div>
    </aside>
  );
}
