// RunLock: per-conversation lock to prevent concurrent agent runs

export class RunLock {
  private locks = new Map<string, Promise<void>>();

  /**
   * Acquire a lock for a conversation. Returns a release function.
   * If a lock is already held, waits for it to release first.
   */
  async acquire(conversationId: string): Promise<() => void> {
    // Wait for any existing lock to release
    while (this.locks.has(conversationId)) {
      await this.locks.get(conversationId);
    }

    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = () => {
        this.locks.delete(conversationId);
        resolve();
      };
    });

    this.locks.set(conversationId, promise);
    return release;
  }

  /** Check if a conversation is currently locked. */
  isLocked(conversationId: string): boolean {
    return this.locks.has(conversationId);
  }

  /** Return all conversation IDs that currently have an active run. */
  get activeConversationIds(): string[] {
    return [...this.locks.keys()];
  }
}
