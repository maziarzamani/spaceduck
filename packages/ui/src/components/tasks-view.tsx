import { useState } from "react";
import { ArrowLeft, Loader2, Plus, AlertTriangle } from "lucide-react";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { useConfig } from "../hooks/use-config";
import { useTasks } from "../hooks/use-tasks";
import { SpendCards } from "./tasks/spend-cards";
import { TaskList } from "./tasks/task-list";
import { CreateTaskDialog } from "./tasks/create-task-dialog";

interface TasksViewProps {
  onBack: () => void;
}

export function TasksView({ onBack }: TasksViewProps) {
  const cfg = useConfig();
  const schedulerEnabled = !!(cfg.config?.scheduler as Record<string, unknown> | undefined)?.enabled;
  const { tasks, budget, loading, error, createTask, cancelTask, retryTask } = useTasks({
    pollIntervalMs: 5000,
  });
  const [createOpen, setCreateOpen] = useState(false);

  const handleEnableScheduler = async () => {
    await cfg.patchConfig([{ op: "replace", path: "/scheduler/enabled", value: true }]);
    window.location.reload();
  };

  return (
    <div className="flex h-screen bg-background">
      <div className="flex flex-col w-full">
        <div className="flex items-center justify-between px-6 py-3 border-b border-border">
          <Button variant="ghost" size="sm" className="gap-2" onClick={onBack}>
            <ArrowLeft size={16} />
            Back to Chat
          </Button>
          <h1 className="text-sm font-semibold">Tasks</h1>
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            New task
          </Button>
        </div>

        <CreateTaskDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreate={createTask}
        />

        <ScrollArea className="flex-1">
          <div className="max-w-4xl mx-auto p-6 flex flex-col gap-6">
            {!schedulerEnabled && !cfg.loading && (
              <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
                <AlertTriangle size={18} className="text-yellow-500 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Scheduler is disabled</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Enable the scheduler to create and run tasks.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={handleEnableScheduler}>
                  Enable
                </Button>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <SpendCards
                  daily={budget.daily}
                  monthly={budget.monthly}
                  schedulerStatus={budget.schedulerStatus}
                  schedulerPaused={budget.schedulerPaused}
                />

                <Separator />

                <div>
                  <h2 className="text-lg font-semibold mb-4">Tasks</h2>
                  <TaskList
                    tasks={tasks}
                    onCancel={cancelTask}
                    onRetry={retryTask}
                  />
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
