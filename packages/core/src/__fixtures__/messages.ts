// Test fixture: message and conversation factory functions

import type { Message, Conversation } from "../types";

let counter = 0;

function nextId(): string {
  counter++;
  return `test-${counter.toString().padStart(4, "0")}`;
}

export function createMessage(overrides?: Partial<Message>): Message {
  return {
    id: nextId(),
    role: "user",
    content: "test message",
    timestamp: Date.now(),
    ...overrides,
  };
}

export function createConversation(overrides?: Partial<Conversation>): Conversation {
  return {
    id: nextId(),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    messages: [],
    ...overrides,
  };
}

/** Reset the counter (call in beforeEach for deterministic IDs). */
export function resetFixtures(): void {
  counter = 0;
}
