import { cn } from "../lib/utils";
import type { ConversationSummary } from "@spaceduck/core";
import { MessageSquarePlus, Trash2, MessageCircle, Settings } from "lucide-react";
import { SpaceduckLogo } from "./spaceduck-logo";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface SidebarProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onOpenSettings?: () => void;
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function Sidebar({ conversations, activeId, onSelect, onCreate, onDelete, onOpenSettings }: SidebarProps) {
  return (
    <aside className="flex flex-col w-64 h-full bg-card border-r border-border">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <SpaceduckLogo size={28} />
          <h1 className="text-sm font-semibold tracking-tight">spaceduck</h1>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onCreate} className="h-8 w-8">
              <MessageSquarePlus size={18} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">New conversation</TooltipContent>
        </Tooltip>
      </div>

      <Separator />

      <ScrollArea className="flex-1">
        <nav className="py-2 px-2">
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground text-center mt-8 px-4">
              No conversations yet. Start a new one!
            </p>
          )}
          {conversations.map((conv) => (
            <button
              key={conv.id}
              type="button"
              className={cn(
                "group flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg transition-colors mb-0.5",
                activeId === conv.id
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => onSelect(conv.id)}
            >
              <MessageCircle size={14} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{conv.title || "Untitled"}</p>
                <p className="text-xs text-muted-foreground">{timeAgo(conv.lastActiveAt)}</p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        onDelete(conv.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                  >
                    <Trash2 size={14} />
                  </span>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            </button>
          ))}
        </nav>
      </ScrollArea>

      <Separator />
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-xs text-muted-foreground">spaceduck v0.1.0</p>
        {onOpenSettings && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onOpenSettings} className="h-7 w-7">
                <Settings size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}
