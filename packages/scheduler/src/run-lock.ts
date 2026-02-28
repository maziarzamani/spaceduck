// RunLock: re-exported interface for per-conversation serialization
//
// The canonical implementation lives in packages/gateway/src/run-lock.ts.
// This interface allows the scheduler to accept any RunLock-compatible object
// without depending on the gateway package.

export interface RunLock {
  acquire(conversationId: string): Promise<() => void>;
  isLocked(conversationId: string): boolean;
}
