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
} from "./context-builder";

// Session manager
export { InMemorySessionManager } from "./session-manager";

// Fact extractor
export { FactExtractor, guardFact, type FactCandidate } from "./fact-extractor";

// Agent
export { type AgentDeps, type AgentRunResult, type AgentChunk, AgentLoop } from "./agent";

// Tool registry
export { type ToolHandler, ToolRegistry } from "./tool-registry";
