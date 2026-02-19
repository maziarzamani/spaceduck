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
} from "./memory";

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
