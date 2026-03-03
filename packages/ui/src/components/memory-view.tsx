import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Loader2, Search, Trash2, Brain, Clock, Sparkles, Tag } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
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
import { useMemories, type MemoryRecord } from "../hooks/use-memories";

interface MemoryViewProps {
  onBack: () => void;
}

const KIND_LABELS: Record<string, string> = {
  fact: "Fact",
  episode: "Episode",
  procedure: "Procedure",
};

const STATUS_LABELS: Record<string, string> = {
  candidate: "Candidate",
  active: "Active",
  stale: "Stale",
  superseded: "Superseded",
  archived: "Archived",
};

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatProvenance(source: MemoryRecord["source"]): string | null {
  const parts: string[] = [];
  if (source.skillId) parts.push(`skill: ${source.skillId}`);
  if (source.taskId) parts.push(`task: ${source.taskId.slice(0, 8)}`);
  if (source.toolName) parts.push(`tool: ${source.toolName}`);
  if (parts.length === 0) {
    const typeLabel = source.type.replace(/_/g, " ");
    return typeLabel;
  }
  return parts.join(" · ");
}

function MemoryCard({
  memory,
  onDelete,
}: {
  memory: MemoryRecord;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const provenance = formatProvenance(memory.source);

  return (
    <div className="group rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/30">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-sm font-medium truncate">{memory.title}</h3>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
              {KIND_LABELS[memory.kind] ?? memory.kind}
            </Badge>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
              {STATUS_LABELS[memory.status] ?? memory.status}
            </Badge>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
              {memory.scope.type}
            </Badge>
          </div>

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-left w-full"
          >
            <p className={`text-xs text-muted-foreground ${expanded ? "" : "line-clamp-2"}`}>
              {expanded ? memory.content : memory.summary || memory.content}
            </p>
          </button>

          <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {timeAgo(memory.createdAt)}
            </span>
            {memory.importance > 0 && (
              <span className="flex items-center gap-1">
                <Sparkles size={10} />
                {Math.round(memory.importance * 100)}%
              </span>
            )}
            {provenance && (
              <span className="flex items-center gap-1">
                <Brain size={10} />
                {provenance}
              </span>
            )}
            {memory.tags.length > 0 && (
              <span className="flex items-center gap-1">
                <Tag size={10} />
                {memory.tags.slice(0, 3).join(", ")}
                {memory.tags.length > 3 && `+${memory.tags.length - 3}`}
              </span>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(memory.id)}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  );
}

export function MemoryView({ onBack }: MemoryViewProps) {
  const {
    memories,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,
    deleteMemory,
  } = useMemories();

  const [deleteTarget, setDeleteTarget] = useState<MemoryRecord | null>(null);
  const [inputValue, setInputValue] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setSearchQuery(inputValue);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [inputValue, setSearchQuery]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteMemory(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <div className="flex h-screen bg-background">
      <div className="flex flex-col w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border">
          <Button variant="ghost" size="sm" className="gap-2" onClick={onBack}>
            <ArrowLeft size={16} />
            Back to Chat
          </Button>
          <h1 className="text-sm font-semibold">Memories</h1>
          <div className="w-[100px]" />
        </div>

        {/* Search + Filters */}
        <div className="px-6 py-4 border-b border-border space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search memories..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={filters.kinds ?? "all"}
              onValueChange={(v) => setFilters({ ...filters, kinds: v === "all" ? undefined : v })}
            >
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="Kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                <SelectItem value="fact">Fact</SelectItem>
                <SelectItem value="episode">Episode</SelectItem>
                <SelectItem value="procedure">Procedure</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.status ?? "all"}
              onValueChange={(v) => setFilters({ ...filters, status: v === "all" ? undefined : v })}
            >
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="candidate">Candidate</SelectItem>
                <SelectItem value="stale">Stale</SelectItem>
                <SelectItem value="superseded">Superseded</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.scope ?? "all"}
              onValueChange={(v) => setFilters({ ...filters, scope: v === "all" ? undefined : v })}
            >
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All scopes</SelectItem>
                <SelectItem value="global">Global</SelectItem>
              </SelectContent>
            </Select>

            {memories.length > 0 && (
              <span className="text-xs text-muted-foreground ml-auto">
                {memories.length} {memories.length === 1 ? "memory" : "memories"}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="max-w-4xl mx-auto p-6 flex flex-col gap-3">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
              </div>
            ) : memories.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Brain size={40} className="mb-3 opacity-30" />
                <p className="text-sm font-medium">
                  {searchQuery ? "No memories match your search" : "No memories yet"}
                </p>
                <p className="text-xs mt-1">
                  {searchQuery
                    ? "Try a different query or adjust filters"
                    : "Memories will appear here as you chat"}
                </p>
              </div>
            ) : (
              memories.map((memory) => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  onDelete={() => setDeleteTarget(memory)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete memory?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{deleteTarget?.title}&rdquo;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
