import { useState, useEffect, useCallback, useRef } from "react";
import type { Task, TaskStatus, TaskInput } from "@spaceduck/core";

function getAuth() {
  const gatewayUrl = localStorage.getItem("spaceduck.gatewayUrl") ?? "";
  const token = localStorage.getItem("spaceduck.token");
  return { gatewayUrl, token };
}

async function taskFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { gatewayUrl, token } = getAuth();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (init?.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${gatewayUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type SchedulerStatus = "stopped" | "starting" | "running" | "stopping";

export interface BudgetSummary {
  daily: number | null;
  monthly: number | null;
  schedulerStatus: SchedulerStatus;
  schedulerPaused: boolean;
}

export interface UseTasksReturn {
  tasks: Task[];
  budget: BudgetSummary;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createTask: (input: TaskInput) => Promise<string | null>;
  cancelTask: (id: string) => Promise<boolean>;
  retryTask: (id: string) => Promise<boolean>;
}

interface UseTasksOptions {
  pollIntervalMs?: number;
  enabled?: boolean;
  statusFilter?: TaskStatus;
}

export function useTasks(opts: UseTasksOptions = {}): UseTasksReturn {
  const { pollIntervalMs = 5000, enabled = true, statusFilter } = opts;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [budget, setBudget] = useState<BudgetSummary>({
    daily: null,
    monthly: null,
    schedulerStatus: "stopped",
    schedulerPaused: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const statusParam = statusFilter ? `?status=${statusFilter}` : "";
      const [tasksRes, budgetRes] = await Promise.all([
        taskFetch<{ tasks: Task[] }>(`/api/tasks${statusParam}`),
        taskFetch<BudgetSummary>("/api/tasks/budget"),
      ]);
      if (mountedRef.current) {
        setTasks(tasksRes.tasks);
        setBudget(budgetRes);
        setError(null);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load tasks");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [enabled, statusFilter]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  useEffect(() => {
    if (!enabled || pollIntervalMs <= 0) return;
    const id = setInterval(load, pollIntervalMs);
    return () => clearInterval(id);
  }, [enabled, pollIntervalMs, load]);

  const createTask = useCallback(async (input: TaskInput): Promise<string | null> => {
    try {
      await taskFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify(input),
      });
      await load();
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create task";
      setError(msg);
      return msg;
    }
  }, [load]);

  const cancelTask = useCallback(async (id: string): Promise<boolean> => {
    try {
      await taskFetch(`/api/tasks/${id}`, { method: "DELETE" });
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel task");
      return false;
    }
  }, [load]);

  const retryTask = useCallback(async (id: string): Promise<boolean> => {
    try {
      await taskFetch(`/api/tasks/${id}/retry`, { method: "POST" });
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to retry task");
      return false;
    }
  }, [load]);

  return { tasks, budget, loading, error, refresh: load, createTask, cancelTask, retryTask };
}
