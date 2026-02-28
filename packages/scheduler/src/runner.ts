// TaskRunner: executes a single task through the agent loop with budget enforcement

import type {
  Task, TaskBudget, BudgetSnapshot,
  AgentLoop, Message, EventBus, Logger,
  ConversationStore, MemoryStore, MemoryInput,
} from "@spaceduck/core";
import { BudgetGuard } from "./budget-guard";
import type { TaskRunResult } from "./queue";

export type TaskRunnerFn = (task: Task, chainedContext?: string) => Promise<TaskRunResult>;

export interface TaskRunnerDeps {
  readonly agent: AgentLoop;
  readonly conversationStore: ConversationStore;
  readonly memoryStore?: MemoryStore;
  readonly eventBus: EventBus;
  readonly logger: Logger;
  readonly defaultBudget: Required<TaskBudget>;
  readonly enqueueFn?: (taskDefinitionId: string, context?: string) => Promise<void>;
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function resolveBudget(task: Task, defaults: Required<TaskBudget>): Required<TaskBudget> {
  return {
    maxTokens: task.budget.maxTokens ?? defaults.maxTokens,
    maxCostUsd: task.budget.maxCostUsd ?? defaults.maxCostUsd,
    maxWallClockMs: task.budget.maxWallClockMs ?? defaults.maxWallClockMs,
    maxToolCalls: task.budget.maxToolCalls ?? defaults.maxToolCalls,
  };
}

export function createTaskRunner(deps: TaskRunnerDeps): TaskRunnerFn {
  const log = deps.logger.child({ component: "TaskRunner" });

  return async (task: Task, chainedContext?: string): Promise<TaskRunResult> => {
    const budget = resolveBudget(task, deps.defaultBudget);
    const guard = new BudgetGuard(budget, deps.eventBus, task);

    try {
      const convId = task.definition.conversationId ?? `task-${task.id}-${generateId()}`;

      const existingConv = await deps.conversationStore.load(convId);
      if (existingConv.ok && !existingConv.value) {
        await deps.conversationStore.create(convId, `Task: ${task.definition.name}`);
      }

      let prompt = task.definition.prompt;
      if (chainedContext) {
        prompt += `\n\n<previous_task_output>\n${chainedContext}\n</previous_task_output>`;
      }

      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content: prompt,
        timestamp: Date.now(),
        source: "system",
      };

      let fullResponse = "";

      for await (const chunk of deps.agent.run(convId, userMessage, { signal: guard.signal })) {
        if (chunk.type === "text") {
          fullResponse += chunk.text;
          guard.trackChars(chunk.text.length);
        } else if (chunk.type === "tool_call") {
          guard.trackToolCall();
        } else if (chunk.type === "usage") {
          guard.replaceWithExactUsage(chunk.usage.inputTokens, chunk.usage.outputTokens);
        }
      }

      const snapshot = guard.snapshot;

      await routeResult(task, fullResponse, snapshot, deps, log);

      return { response: fullResponse, snapshot };
    } finally {
      guard.dispose();
    }
  };
}

async function routeResult(
  task: Task,
  response: string,
  snapshot: BudgetSnapshot,
  deps: TaskRunnerDeps,
  logger: Logger,
): Promise<void> {
  const route = task.definition.resultRoute;

  if (route === "silent") {
    logger.debug("Task result routed to silent", { taskId: task.id });
    return;
  }

  if (route === "notify") {
    logger.info("Task result routed to notify", { taskId: task.id, responseLength: response.length });
    // Notification is handled by the gateway layer via EventBus
    // The task:completed event carries the snapshot; gateway can decide how to notify
    return;
  }

  if (route === "memory_update") {
    if (!deps.memoryStore) {
      logger.warn("memory_update route requested but no MemoryStore available", { taskId: task.id });
      return;
    }

    const memoryInput: MemoryInput = {
      kind: "episode",
      title: `Task result: ${task.definition.name}`,
      content: response.slice(0, 5000),
      scope: { type: "global" },
      source: {
        type: "system",
        taskId: task.id,
      },
      tags: ["task-result", task.definition.type],
      occurredAt: Date.now(),
    };

    const result = await deps.memoryStore.store(memoryInput);
    if (!result.ok) {
      logger.warn("Failed to store task result as memory", { taskId: task.id, error: String(result.error) });
    }

    return;
  }

  if (typeof route === "object" && route.type === "chain_next") {
    const context = route.contextFromResult ? response : undefined;
    if (deps.enqueueFn) {
      await deps.enqueueFn(route.taskDefinitionId, context);
      logger.info("Chained task enqueued", {
        taskId: task.id, nextTaskId: route.taskDefinitionId,
        hasContext: !!context,
      });
    } else {
      logger.warn("chain_next route requested but no enqueueFn available", { taskId: task.id });
    }
    return;
  }
}
