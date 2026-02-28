// Barrel export — the public type surface of @spaceduck/core types

export type {
  Message,
  Conversation,
  ResponseStatus,
} from "./message";

export type {
  Attachment,
} from "./attachment";

export type {
  Provider,
  ProviderOptions,
  ProviderErrorCode,
  ProviderChunk,
} from "./provider";

export type {
  ToolDefinition,
  ToolCall,
  ToolResult,
} from "./tool";

export type {
  Channel,
  ChannelMessage,
  ChannelResponse,
} from "./channel";

export type {
  ConversationStore,
  LongTermMemory,
  Fact,
  FactInput,
  FactSlot,
  SlotFactInput,
  RecallOptions,
  MemoryKind,
  MemoryStatus,
  ProcedureSubtype,
  MemoryScope,
  MemorySource,
  MemoryRecord,
  FactMemoryInput,
  EpisodeMemoryInput,
  ProcedureMemoryInput,
  MemoryInput,
  MemoryPatch,
  RetentionReason,
  RetentionDecision,
  MemoryRecallOptions,
  ScoredMemory,
  MemoryFilter,
  MemoryStore,
  ImportanceBucket,
  ConfidenceBucket,
} from "./memory";
export { IMPORTANCE_MAP, CONFIDENCE_MAP } from "./memory";

export type {
  EmbeddingProvider,
  EmbedPurpose,
  EmbedOptions,
} from "./embedding";

export type {
  Session,
  SessionManager,
} from "./session";

export type {
  Lifecycle,
  LifecycleStatus,
} from "./lifecycle";

export type {
  Logger,
  LogLevel,
} from "./logger";
export { ConsoleLogger } from "./logger";

export type {
  WsClientEnvelope,
  WsServerEnvelope,
  ConversationSummary,
} from "./protocol";

export type {
  TaskType,
  TaskDefinition,
  TaskSchedule,
  TaskBudget,
  TaskResultRoute,
  TaskStatus,
  BudgetSnapshot,
  Task,
  TaskInput,
  TaskPatch,
  TaskRunStatus,
  TaskRun,
  SpendPeriod,
  TaskStore,
} from "./task";

export {
  SpaceduckError,
  ProviderError,
  MemoryError,
  ChannelError,
  ConfigError,
  SessionError,
  ok,
  err,
} from "./errors";
export type { Result } from "./errors";
