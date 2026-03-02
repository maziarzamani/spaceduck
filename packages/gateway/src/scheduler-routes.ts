// Scheduler REST API routes — separate module for clean gateway integration

import type { Logger, TaskStore, TaskInput } from "@spaceduck/core";
import type { TaskScheduler } from "@spaceduck/scheduler";

export interface SchedulerRouteDeps {
  readonly store: TaskStore;
  readonly scheduler: TaskScheduler;
  readonly logger: Logger;
}

export async function handleSchedulerRoute(
  req: Request,
  url: URL,
  deps: SchedulerRouteDeps,
): Promise<Response | null> {
  const { store, scheduler, logger } = deps;

  // POST /api/tasks — create a task
  if (req.method === "POST" && url.pathname === "/api/tasks") {
    try {
      const body = await req.json() as TaskInput;
      const result = await store.create(body);
      if (!result.ok) {
        return Response.json({ error: result.error.message }, { status: 400 });
      }
      return Response.json(result.value, { status: 201 });
    } catch (e) {
      logger.error("Failed to create task", { error: String(e) });
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
  }

  // GET /api/tasks — list tasks
  if (req.method === "GET" && url.pathname === "/api/tasks") {
    const status = url.searchParams.get("status") as any;
    const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);

    if (status) {
      const result = await store.listByStatus(status, limit);
      if (!result.ok) return Response.json({ error: result.error.message }, { status: 500 });
      return Response.json({ tasks: result.value });
    }

    const statuses = ["pending", "scheduled", "running", "completed", "failed", "dead_letter", "cancelled"] as const;
    const all: any[] = [];
    for (const s of statuses) {
      const result = await store.listByStatus(s, limit);
      if (result.ok) all.push(...result.value);
    }
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    return Response.json({ tasks: all.slice(0, limit) });
  }

  // GET /api/tasks/budget — global spend summary
  if (req.method === "GET" && url.pathname === "/api/tasks/budget") {
    const dayResult = await store.sumSpend("day");
    const monthResult = await store.sumSpend("month");
    return Response.json({
      daily: dayResult.ok ? dayResult.value : null,
      monthly: monthResult.ok ? monthResult.value : null,
      schedulerStatus: scheduler.status,
      schedulerPaused: scheduler.isPaused,
    });
  }

  // Match /api/tasks/:id routes
  const taskIdMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskIdMatch) {
    const taskId = taskIdMatch[1];

    // GET /api/tasks/:id
    if (req.method === "GET") {
      const result = await store.get(taskId);
      if (!result.ok) return Response.json({ error: result.error.message }, { status: 500 });
      if (!result.value) return Response.json({ error: "Task not found" }, { status: 404 });
      return Response.json(result.value);
    }

    // DELETE /api/tasks/:id — cancel
    if (req.method === "DELETE") {
      const result = await store.cancel(taskId);
      if (!result.ok) return Response.json({ error: result.error.message }, { status: 500 });
      return Response.json({ status: "cancelled" });
    }
  }

  // GET /api/tasks/:id/runs — run history
  const runsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/runs$/);
  if (runsMatch && req.method === "GET") {
    const taskId = runsMatch[1];
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
    const result = await store.listRuns(taskId, limit);
    if (!result.ok) return Response.json({ error: result.error.message }, { status: 500 });
    return Response.json({ runs: result.value });
  }

  // POST /api/tasks/:id/retry
  const retryMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/retry$/);
  if (retryMatch && req.method === "POST") {
    const taskId = retryMatch[1];
    const getResult = await store.get(taskId);
    if (!getResult.ok) return Response.json({ error: getResult.error.message }, { status: 500 });
    if (!getResult.value) return Response.json({ error: "Task not found" }, { status: 404 });

    const task = getResult.value;
    if (task.status !== "dead_letter" && task.status !== "failed") {
      return Response.json({ error: `Cannot retry task with status '${task.status}'` }, { status: 400 });
    }

    const updateResult = await store.update(taskId, {
      status: "scheduled",
      nextRunAt: Date.now(),
      retryCount: 0,
      error: null,
    });
    if (!updateResult.ok) return Response.json({ error: updateResult.error.message }, { status: 500 });
    return Response.json(updateResult.value);
  }

  return null;
}
