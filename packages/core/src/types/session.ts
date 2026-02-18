// Session management: maps (channelId, senderId) to a conversation

export interface Session {
  readonly id: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly senderId: string;
  readonly createdAt: number;
  readonly lastActiveAt: number;
}

export interface SessionManager {
  /**
   * Resolve or create a session for a given channel + sender.
   * Returns existing session if one exists, creates new one otherwise.
   */
  resolve(channelId: string, senderId: string): Promise<Session>;

  /**
   * Reset a session — creates a new conversation for the same sender.
   */
  reset(sessionId: string): Promise<Session>;

  /**
   * Get an existing session by ID, or null if not found.
   */
  get(sessionId: string): Promise<Session | null>;

  /**
   * Update the lastActiveAt timestamp for a session.
   */
  touch(sessionId: string): Promise<void>;
}
