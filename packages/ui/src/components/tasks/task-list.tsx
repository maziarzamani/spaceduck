import { useState } from "react";
import { Loader2, XCircle, RotateCcw, Clock, CheckCircle2, AlertTriangle, Ban, Skull, ChevronDown } from "lucide-react";
import Markdown from "react-markdown";
import { Tabs, TabsList, TabsTrigger } from "../../ui/tabs";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Card } from "../../ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import type { Task, TaskStatus } from "@spaceduck/core";

type FilterTab = "all" | "running" | "scheduled" | "failed" | "dead_letter";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "scheduled", label: "Scheduled" },
  { id: "failed", label: "Failed" },
  { id: "dead_letter", label: "Dead letter" },
];

interface TaskListProps {
  tasks: Task[];
  onCancel: (id: string) => Promise<boolean>;
  onRetry: (id: string) => Promise<boolean>;
}

function statusIcon(status: TaskStatus) {
  switch (status) {
    case "running":
      return <Loader2 size={14} className="animate-spin text-blue-500" />;
    case "scheduled":
    case "pending":
      return <Clock size={14} className="text-muted-foreground" />;
    case "completed":
      return <CheckCircle2 size={14} className="text-green-500" />;
    case "failed":
      return <AlertTriangle size={14} className="text-red-500" />;
    case "dead_letter":
      return <Skull size={14} className="text-orange-500" />;
    case "cancelled":
      return <Ban size={14} className="text-muted-foreground" />;
  }
}

function statusBadgeVariant(status: TaskStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default";
    case "completed":
      return "secondary";
    case "failed":
    case "dead_letter":
      return "destructive";
    default:
      return "outline";
  }
}

function formatCost(snapshot?: { estimatedCostUsd: number }): string {
  if (!snapshot) return "--";
  return `$${snapshot.estimatedCostUsd.toFixed(4)}`;
}

function formatTime(ts: number | null): string {
  if (!ts) return "--";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function canCancel(status: TaskStatus): boolean {
  return status === "running" || status === "scheduled" || status === "pending";
}

function canRetry(status: TaskStatus): boolean {
  return status === "failed" || status === "dead_letter";
}

export function TaskList({ tasks, onCancel, onRetry }: TaskListProps) {
  const [tab, setTab] = useState<FilterTab>("all");
  const [cancelTarget, setCancelTarget] = useState<Task | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = tab === "all" ? tasks : tasks.filter((t) => t.status === tab);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCancel = async (task: Task) => {
    setActionLoading(task.id);
    await onCancel(task.id);
    setActionLoading(null);
    setCancelTarget(null);
  };

  const handleRetry = async (task: Task) => {
    setActionLoading(task.id);
    await onRetry(task.id);
    setActionLoading(null);
  };

  const hasExpandableContent = (task: Task) =>
    !!(task.resultText || task.error);

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
        <TabsList>
          {TABS.map((t) => {
            const count = t.id === "all" ? tasks.length : tasks.filter((tk) => tk.status === t.id).length;
            return (
              <TabsTrigger key={t.id} value={t.id} className="gap-1.5">
                {t.label}
                {count > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">({count})</span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <Card className="p-8">
          <p className="text-sm text-muted-foreground text-center">
            {tab === "all" ? "No tasks yet." : `No ${tab.replace("_", " ")} tasks.`}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((task) => (
            <Collapsible
              key={task.id}
              open={expanded.has(task.id)}
              onOpenChange={() => hasExpandableContent(task) && toggleExpanded(task.id)}
            >
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  {statusIcon(task.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <CollapsibleTrigger asChild disabled={!hasExpandableContent(task)}>
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-sm font-medium truncate hover:underline disabled:hover:no-underline disabled:cursor-default text-left"
                        >
                          {task.definition.name}
                          {hasExpandableContent(task) && (
                            <ChevronDown
                              size={12}
                              className={`shrink-0 text-muted-foreground transition-transform ${expanded.has(task.id) ? "rotate-180" : ""}`}
                            />
                          )}
                        </button>
                      </CollapsibleTrigger>
                      <Badge variant={statusBadgeVariant(task.status)} className="text-xs shrink-0">
                        {task.status.replace("_", " ")}
                      </Badge>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {task.definition.type}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      <span>Cost: {formatCost(task.budgetConsumed)}</span>
                      <span>Last run: {formatTime(task.lastRunAt)}</span>
                      <span>Next: {formatTime(task.nextRunAt)}</span>
                      {task.error && !expanded.has(task.id) && (
                        <span className="text-destructive truncate max-w-[200px]" title={task.error}>
                          {task.error}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {canRetry(task.status) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={actionLoading === task.id}
                        onClick={(e) => { e.stopPropagation(); handleRetry(task); }}
                        title="Retry"
                      >
                        {actionLoading === task.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <RotateCcw size={14} />
                        )}
                      </Button>
                    )}
                    {canCancel(task.status) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        disabled={actionLoading === task.id}
                        onClick={(e) => { e.stopPropagation(); setCancelTarget(task); }}
                        title="Cancel"
                      >
                        {actionLoading === task.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <XCircle size={14} />
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                <CollapsibleContent>
                  <div className="mt-3 pt-3 border-t border-border space-y-3">
                    {task.error && (
                      <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
                        <p className="text-xs font-medium text-destructive mb-1">Error</p>
                        <p className="text-xs text-destructive/80 whitespace-pre-wrap">{task.error}</p>
                      </div>
                    )}
                    {task.resultText && (
                      <div className="rounded-md bg-muted/50 border border-border p-3">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Result</p>
                        <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                          <Markdown>{task.resultText}</Markdown>
                        </div>
                      </div>
                    )}
                    {!task.resultText && !task.error && (
                      <p className="text-xs text-muted-foreground">No output available.</p>
                    )}
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))}
        </div>
      )}

      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel &ldquo;{cancelTarget?.definition.name}&rdquo;. The task will stop running and can be retried later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelTarget && handleCancel(cancelTarget)}
            >
              Cancel task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
