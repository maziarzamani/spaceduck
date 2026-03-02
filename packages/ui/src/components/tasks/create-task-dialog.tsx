import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../ui/tabs";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Textarea } from "../../ui/textarea";
import { Label } from "../../ui/label";
import { Card } from "../../ui/card";
import { Badge } from "../../ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../ui/collapsible";
import { Loader2, ChevronDown, Zap, Play, ArrowLeft } from "lucide-react";
import type { TaskInput, TaskResultRoute } from "@spaceduck/core";
import { useSkills, type SkillSummary } from "../../hooks/use-skills";

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: TaskInput) => Promise<string | null>;
}

type ScheduleMode = "once" | "interval" | "cron";

export function CreateTaskDialog({ open, onOpenChange, onCreate }: CreateTaskDialogProps) {
  const [tab, setTab] = useState<"skill" | "custom">("skill");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async (input: TaskInput) => {
    setSubmitting(true);
    setCreateError(null);
    const err = await onCreate(input);
    setSubmitting(false);
    if (!err) {
      onOpenChange(false);
    } else {
      setCreateError(err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setCreateError(null); onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>

        {createError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <p className="text-sm text-destructive">{createError}</p>
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as "skill" | "custom")}>
          <TabsList className="w-full">
            <TabsTrigger value="skill" className="flex-1 gap-1.5">
              <Zap size={14} />
              Run Skill
            </TabsTrigger>
            <TabsTrigger value="custom" className="flex-1 gap-1.5">
              <Play size={14} />
              Custom Task
            </TabsTrigger>
          </TabsList>
          <TabsContent value="skill">
            <SkillPicker onSubmit={handleCreate} submitting={submitting} />
          </TabsContent>
          <TabsContent value="custom">
            <CustomTaskForm onSubmit={handleCreate} submitting={submitting} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Skill picker
// ---------------------------------------------------------------------------

function SkillPicker({ onSubmit, submitting }: { onSubmit: (input: TaskInput) => void; submitting: boolean }) {
  const { skills, loading, error } = useSkills();
  const [selected, setSelected] = useState<SkillSummary | null>(null);
  const [promptInput, setPromptInput] = useState("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("once");
  const [intervalMin, setIntervalMin] = useState("60");
  const [cronExpr, setCronExpr] = useState("");
  const [resultRoute, setResultRoute] = useState<string>("silent");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 mt-3">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground">
        No skills installed. Add SKILL.md files to your skills directory.
      </div>
    );
  }

  if (selected) {
    const handleRun = () => {
      const schedule =
        scheduleMode === "interval"
          ? { intervalMs: Math.max(1, parseInt(intervalMin, 10) || 60) * 60_000 }
          : scheduleMode === "cron"
            ? { cron: cronExpr || "0 * * * *" }
            : { runImmediately: true };

      onSubmit({
        definition: {
          type: "scheduled",
          name: selected.id,
          prompt: promptInput.trim() || `Run skill: ${selected.id}`,
          toolAllow: selected.toolAllow,
          resultRoute: (resultRoute || selected.resultRoute || "silent") as TaskResultRoute,
          skillId: selected.id,
        },
        schedule,
        budget: selected.budget ? { ...selected.budget } : undefined,
      });
    };

    return (
      <div className="flex flex-col gap-4 mt-3">
        <button
          type="button"
          onClick={() => { setSelected(null); setPromptInput(""); }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors self-start"
        >
          <ArrowLeft size={12} />
          Back to skills
        </button>

        <div>
          <h3 className="text-sm font-semibold">{selected.id}</h3>
          <p className="text-xs text-muted-foreground mt-1">{selected.description}</p>
        </div>

        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label>Input</Label>
            <Textarea
              placeholder="What should this skill work on? (leave empty if not needed)"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="grid gap-2">
            <Label>Schedule</Label>
            <Select value={scheduleMode} onValueChange={(v) => setScheduleMode(v as ScheduleMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Run once now</SelectItem>
                <SelectItem value="interval">Repeat on interval</SelectItem>
                <SelectItem value="cron">Cron expression</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scheduleMode === "interval" && (
            <div className="grid gap-2">
              <Label>Interval (minutes)</Label>
              <Input
                type="number"
                min={1}
                value={intervalMin}
                onChange={(e) => setIntervalMin(e.target.value)}
              />
            </div>
          )}

          {scheduleMode === "cron" && (
            <div className="grid gap-2">
              <Label>Cron expression</Label>
              <Input
                placeholder="0 9 * * *"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">5-field format: minute hour dom month dow</p>
            </div>
          )}

          <div className="grid gap-2">
            <Label>Result route</Label>
            <Select value={resultRoute} onValueChange={setResultRoute}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="silent">Silent</SelectItem>
                <SelectItem value="notify">Notify</SelectItem>
                <SelectItem value="memory_update">Save to memory</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selected.budget && (
            <div className="rounded-md border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Budget from skill</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {selected.budget.maxTokens != null && <span>Max tokens: {selected.budget.maxTokens}</span>}
                {selected.budget.maxCostUsd != null && <span>Max cost: ${selected.budget.maxCostUsd}</span>}
                {selected.budget.maxToolCalls != null && <span>Max tool calls: {selected.budget.maxToolCalls}</span>}
                {selected.budget.maxMemoryWrites != null && <span>Max memory writes: {selected.budget.maxMemoryWrites}</span>}
              </div>
            </div>
          )}
        </div>

        <Button onClick={handleRun} disabled={submitting} className="w-full">
          {submitting ? <Loader2 size={14} className="animate-spin mr-2" /> : <Play size={14} className="mr-2" />}
          Run {selected.id}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 mt-3">
      {skills.map((skill) => (
        <Card
          key={skill.id}
          className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setSelected(skill)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{skill.id}</p>
                {skill.version && (
                  <Badge variant="outline" className="text-xs">{skill.version}</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{skill.description}</p>
            </div>
            {skill.author && (
              <span className="text-xs text-muted-foreground shrink-0">{skill.author}</span>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom task form
// ---------------------------------------------------------------------------

function CustomTaskForm({ onSubmit, submitting }: { onSubmit: (input: TaskInput) => void; submitting: boolean }) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [taskType, setTaskType] = useState<"heartbeat" | "scheduled">("scheduled");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("once");
  const [intervalMin, setIntervalMin] = useState("60");
  const [cronExpr, setCronExpr] = useState("");
  const [resultRoute, setResultRoute] = useState<string>("silent");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [maxTokens, setMaxTokens] = useState("");
  const [maxCostUsd, setMaxCostUsd] = useState("");
  const [maxToolCalls, setMaxToolCalls] = useState("");
  const [maxMemoryWrites, setMaxMemoryWrites] = useState("");

  const canSubmit = name.trim() && prompt.trim();

  const handleSubmit = () => {
    if (!canSubmit) return;

    const schedule =
      scheduleMode === "interval"
        ? { intervalMs: Math.max(1, parseInt(intervalMin, 10) || 60) * 60_000 }
        : scheduleMode === "cron"
          ? { cron: cronExpr || "0 * * * *" }
          : { runImmediately: true };

    const budget: Record<string, number> = {};
    if (maxTokens) budget.maxTokens = parseInt(maxTokens, 10);
    if (maxCostUsd) budget.maxCostUsd = parseFloat(maxCostUsd);
    if (maxToolCalls) budget.maxToolCalls = parseInt(maxToolCalls, 10);
    if (maxMemoryWrites) budget.maxMemoryWrites = parseInt(maxMemoryWrites, 10);

    onSubmit({
      definition: {
        type: taskType,
        name: name.trim(),
        prompt: prompt.trim(),
        resultRoute: resultRoute as TaskResultRoute,
      },
      schedule,
      budget: Object.keys(budget).length > 0 ? budget : undefined,
    });
  };

  return (
    <div className="flex flex-col gap-4 mt-3">
      <div className="grid gap-2">
        <Label>Name</Label>
        <Input
          placeholder="e.g. Weekly report check"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label>Prompt</Label>
        <Textarea
          placeholder="What should the agent do?"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Type</Label>
          <Select value={taskType} onValueChange={(v) => setTaskType(v as "heartbeat" | "scheduled")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="heartbeat">Heartbeat</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Result route</Label>
          <Select value={resultRoute} onValueChange={setResultRoute}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="silent">Silent</SelectItem>
              <SelectItem value="notify">Notify</SelectItem>
              <SelectItem value="memory_update">Save to memory</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Schedule</Label>
        <Select value={scheduleMode} onValueChange={(v) => setScheduleMode(v as ScheduleMode)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="once">Run once now</SelectItem>
            <SelectItem value="interval">Repeat on interval</SelectItem>
            <SelectItem value="cron">Cron expression</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {scheduleMode === "interval" && (
        <div className="grid gap-2">
          <Label>Interval (minutes)</Label>
          <Input
            type="number"
            min={1}
            value={intervalMin}
            onChange={(e) => setIntervalMin(e.target.value)}
          />
        </div>
      )}

      {scheduleMode === "cron" && (
        <div className="grid gap-2">
          <Label>Cron expression</Label>
          <Input
            placeholder="0 9 * * *"
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">5-field format: minute hour dom month dow</p>
        </div>
      )}

      <Collapsible open={budgetOpen} onOpenChange={setBudgetOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground">
            Budget limits (optional)
            <ChevronDown size={14} className={`transition-transform ${budgetOpen ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="grid gap-1">
              <Label className="text-xs">Max tokens</Label>
              <Input
                type="number"
                placeholder="e.g. 10000"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Max cost ($)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g. 0.10"
                value={maxCostUsd}
                onChange={(e) => setMaxCostUsd(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Max tool calls</Label>
              <Input
                type="number"
                placeholder="e.g. 10"
                value={maxToolCalls}
                onChange={(e) => setMaxToolCalls(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Max memory writes</Label>
              <Input
                type="number"
                placeholder="e.g. 5"
                value={maxMemoryWrites}
                onChange={(e) => setMaxMemoryWrites(e.target.value)}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="w-full">
        {submitting ? <Loader2 size={14} className="animate-spin mr-2" /> : <Play size={14} className="mr-2" />}
        Create task
      </Button>
    </div>
  );
}
