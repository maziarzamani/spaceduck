import { useState, useRef, useEffect } from "react";
import { cn } from "../lib/utils";
import type { ConversationSummary } from "@spaceduck/core";
import { MessageSquarePlus, Trash2, MessageCircle, Settings, Sun, Moon, MoreHorizontal, Pencil, Loader2, ListTodo } from "lucide-react";
import { SpaceduckLogo } from "./spaceduck-logo";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { useTheme } from "../hooks/use-theme";
import { useTasks } from "../hooks/use-tasks";

interface SidebarProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  streamingIds: ReadonlySet<string>;
  unreadIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onOpenSettings?: () => void;
  onOpenTasks?: () => void;
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function Sidebar({ conversations, activeId, streamingIds, unreadIds, onSelect, onCreate, onDelete, onRename, onOpenSettings, onOpenTasks }: SidebarProps) {
  const { resolved, setTheme } = useTheme();
  const { tasks, budget } = useTasks({ pollIntervalMs: 30_000 });
  const runningCount = tasks.filter((t) => t.status === "running").length;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startEditing = (conv: ConversationSummary) => {
    setEditingId(conv.id);
    setEditValue(conv.title || "Untitled");
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

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
          {conversations.map((conv) => {
            const isEditing = editingId === conv.id;
            const isStreaming = streamingIds.has(conv.id);
            const isUnread = unreadIds.has(conv.id);

            return (
              <button
                key={conv.id}
                type="button"
                className={cn(
                  "group flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg transition-colors mb-0.5",
                  activeId === conv.id
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                onClick={() => {
                  if (!isEditing) onSelect(conv.id);
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  startEditing(conv);
                }}
              >
                {isStreaming ? (
                  <Loader2 size={14} className="shrink-0 animate-spin text-primary" />
                ) : (
                  <MessageCircle size={14} className="shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <input
                        ref={inputRef}
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") commitEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        onBlur={commitEdit}
                        className="w-full text-sm bg-background border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <p className={cn("text-sm truncate", isUnread && "font-semibold text-foreground")}>
                          {conv.title || "Untitled"}
                        </p>
                        {isUnread && (
                          <span className="shrink-0 h-2 w-2 rounded-full bg-primary" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{timeAgo(conv.lastActiveAt)}</p>
                    </>
                  )}
                </div>
                {!isEditing && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => e.stopPropagation()}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                      >
                        <MoreHorizontal size={14} />
                      </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="bottom">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditing(conv);
                        }}
                      >
                        <Pencil size={14} />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(conv);
                        }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </button>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Task indicator pill */}
      {(runningCount > 0 || (budget.daily !== null && budget.daily > 0)) && onOpenTasks && (
        <>
          <Separator />
          <button
            type="button"
            onClick={onOpenTasks}
            className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-muted transition-colors w-full text-left"
          >
            {runningCount > 0 && (
              <span className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin text-primary" />
                <span>{runningCount} running</span>
              </span>
            )}
            {budget.daily !== null && budget.daily > 0 && (
              <span className="ml-auto tabular-nums">${budget.daily.toFixed(4)} today</span>
            )}
          </button>
        </>
      )}

      <Separator />
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-xs text-muted-foreground">spaceduck v0.1.0</p>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
                className="h-7 w-7"
              >
                {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Toggle theme</TooltipContent>
          </Tooltip>
          {onOpenTasks && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onOpenTasks} className="h-7 w-7">
                  <ListTodo size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Tasks</TooltipContent>
            </Tooltip>
          )}
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
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{deleteTarget?.title || "Untitled"}&rdquo; and all its messages. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) onDelete(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
