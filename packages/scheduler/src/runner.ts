// TaskRunner: executes a single task through the agent loop with budget enforcement

import type {
  Task, TaskBudget, BudgetSnapshot,
  AgentLoop, Message, EventBus, Logger,
  ConversationStore, MemoryStore, MemoryInput, MemoryRecallOptions,
} from "@spaceduck/core";
import { BudgetGuard } from "./budget-guard";
import type { PricingLookup } from "./pricing";
import type { TaskRunResult } from "./queue";

export type TaskRunnerFn = (task: Task, chainedContext?: string) => Promise<TaskRunResult>;

export interface SkillResolver {
  readonly get: (skillId: string) => { toolAllow?: string[]; toolDeny?: string[] } | undefined;
}

export interface TaskRunnerDeps {
  readonly agent: AgentLoop;
  readonly conversationStore: ConversationStore;
  readonly memoryStore?: MemoryStore;
  readonly eventBus: EventBus;
  readonly logger: Logger;
  readonly defaultBudget: Required<TaskBudget>;
  readonly enqueueFn?: (taskDefinitionId: string, context?: string) => Promise<void>;
  readonly pricingLookup?: PricingLookup;
  readonly modelName?: string;
  /** Resolves skill metadata for tool scoping. Provided by gateway when SkillRegistry is available. */
  readonly skillResolver?: SkillResolver;
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
    maxMemoryWrites: task.budget.maxMemoryWrites ?? defaults.maxMemoryWrites,
  };
}

/**
 * Wraps a MemoryStore with a counting proxy that tracks writes via BudgetGuard.
 * When the write budget is exhausted, store() silently returns the input as-is
 * (no-op) and logs a warning. All other methods delegate directly.
 */
function createWriteLimitedStore(
  store: MemoryStore,
  guard: BudgetGuard,
  logger: Logger,
): MemoryStore {
  return {
    ...store,
    async store(input) {
      if (guard.memoryWritesBudgetExhausted) {
        logger.warn("Memory write budget exhausted, dropping write", {
          content: input.content.slice(0, 80),
        });
        return store.get("__noop__") as any;
      }
      const result = await store.store(input);
      if (result.ok) guard.trackMemoryWrite();
      return result;
    },
    async supersede(oldId, newInput) {
      if (guard.memoryWritesBudgetExhausted) {
        logger.warn("Memory write budget exhausted, dropping supersede", {
          oldId, content: newInput.content.slice(0, 80),
        });
        return store.get("__noop__") as any;
      }
      const result = await store.supersede(oldId, newInput);
      if (result.ok) guard.trackMemoryWrite();
      return result;
    },
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

      const memoryRecallOptions: Partial<MemoryRecallOptions> = {
        sourceTaskId: task.id,
        maxMemoryTokens: 2000,
        maxEntries: 15,
      };

      // Compute merged tool filter: intersection for allow, union for deny
      const toolFilter = mergeToolFilter(task.definition, deps.skillResolver);

      let fullResponse = "";

      for await (const chunk of deps.agent.run(convId, userMessage, {
        signal: guard.signal,
        memoryRecallOptions,
        toolFilter,
      })) {
        if (chunk.type === "text") {
          fullResponse += chunk.text;
          guard.trackChars(chunk.text.length);
        } else if (chunk.type === "tool_call") {
          guard.trackToolCall();
        } else if (chunk.type === "usage") {
          const cost = deps.pricingLookup && deps.modelName
            ? deps.pricingLookup.estimate(deps.modelName, chunk.usage)
            : undefined;
          guard.replaceWithExactUsage(chunk.usage, cost);
        }
      }

      const snapshot = guard.snapshot;

      await routeResult(task, fullResponse, snapshot, deps, log, guard);

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
  guard?: BudgetGuard,
): Promise<void> {
  const route = task.definition.resultRoute;

  if (route === "silent") {
    logger.debug("Task result routed to silent", { taskId: task.id });
    return;
  }

  if (route === "notify") {
    logger.info("Task result routed to notify", { taskId: task.id, responseLength: response.length });
    return;
  }

  if (route === "memory_update") {
    if (!deps.memoryStore) {
      logger.warn("memory_update route requested but no MemoryStore available", { taskId: task.id });
      return;
    }

    const store = guard
      ? createWriteLimitedStore(deps.memoryStore, guard, logger)
      : deps.memoryStore;

    const memoryInput: MemoryInput = {
      kind: "episode",
      title: `Task result: ${task.definition.name}`,
      content: response.slice(0, 5000),
      scope: { type: "global" },
      source: {
        type: "system",
        taskId: task.id,
        skillId: task.definition.skillId,
      },
      tags: ["task-result", task.definition.type],
      occurredAt: Date.now(),
    };

    const result = await store.store(memoryInput);
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

/**
 * Merge task-level and skill-level tool filters.
 * - allow: intersection (skill declares what it needs, task can further restrict)
 * - deny: union (both contribute)
 * Returns undefined if no filtering is needed.
 */
function mergeToolFilter(
  definition: Task["definition"],
  skillResolver?: SkillResolver,
): { allow?: string[]; deny?: string[] } | undefined {
  const taskAllow = definition.toolAllow;
  const taskDeny = definition.toolDeny;

  let skillAllow: string[] | undefined;
  let skillDeny: string[] | undefined;

  if (definition.skillId && skillResolver) {
    const skill = skillResolver.get(definition.skillId);
    if (skill) {
      skillAllow = skill.toolAllow;
      skillDeny = skill.toolDeny;
    }
  }

  const hasAllow = !!(taskAllow?.length || skillAllow?.length);
  const hasDeny = !!(taskDeny?.length || skillDeny?.length);

  if (!hasAllow && !hasDeny) return undefined;

  let allow: string[] | undefined;
  if (taskAllow && skillAllow) {
    const skillSet = new Set(skillAllow);
    allow = taskAllow.filter((t) => skillSet.has(t));
  } else {
    allow = taskAllow ?? skillAllow;
  }

  let deny: string[] | undefined;
  if (taskDeny || skillDeny) {
    deny = [...new Set([...(taskDeny ?? []), ...(skillDeny ?? [])])];
  }

  if (!allow?.length && !deny?.length) return undefined;

  return {
    ...(allow?.length ? { allow } : {}),
    ...(deny?.length ? { deny } : {}),
  };
}
