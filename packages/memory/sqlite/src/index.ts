// @spaceduck/memory-sqlite — SQLite implementations of memory interfaces
// Uses bun:sqlite for zero-dependency embedded database

export { SchemaManager, ensureCustomSQLite, reconcileVecFacts, reconcileVecMemories } from "./schema";
export { SqliteConversationStore } from "./store";
export { SqliteMemoryStore, cosineSimilarity } from "./memory-store";
export { SqliteSessionManager } from "./session-store";
