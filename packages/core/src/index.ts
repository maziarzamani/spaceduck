// @spaceduck/core — zero-dependency contract package
// Re-exports all types, interfaces, and core logic

// Types
export * from "./types";

// Events
export { type SpaceduckEvents, type EventBus, SimpleEventBus } from "./events";

// Middleware
export { type MessageContext, type Middleware, composeMiddleware } from "./middleware";

// Config
export { type SpaceduckConfig, loadConfig } from "./config";

// Context builder
export {
  type TokenBudget,
  type ContextWindowManager,
  DEFAULT_TOKEN_BUDGET,
  DefaultContextBuilder,
  prioritizeProcedures,
} from "./context-builder";

// Session manager
export { InMemorySessionManager } from "./session-manager";

// Memory extractor (v2)
export {
  MemoryExtractor,
  guardMemory,
  type MemoryExtractorConfig,
  type ClassifiedMemory,
} from "./memory-extractor";

// Agent
export { type AgentDeps, type AgentRunResult, type AgentChunk, AgentLoop } from "./agent";

// Tool registry
export { type ToolHandler, ToolRegistry } from "./tool-registry";

// Version
export { GATEWAY_VERSION, CLI_VERSION, API_VERSION, GIT_SHA } from "./version";
