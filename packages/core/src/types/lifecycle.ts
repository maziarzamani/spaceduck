// Lifecycle interface for resource-owning components (idempotent)

export type LifecycleStatus = "stopped" | "starting" | "running" | "stopping";

export interface Lifecycle {
  /** Start the component. Idempotent — no-op if already running. */
  start(): Promise<void>;
  /** Stop the component. Idempotent — safe to call without start(). */
  stop(): Promise<void>;
  /** Current lifecycle status. */
  readonly status: LifecycleStatus;
}
