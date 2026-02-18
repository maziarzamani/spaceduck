import { describe, it, expect, beforeEach } from "bun:test";
import { InMemorySessionManager } from "../session-manager";

describe("InMemorySessionManager", () => {
  let manager: InMemorySessionManager;

  beforeEach(() => {
    manager = new InMemorySessionManager();
  });

  it("should create a new session for unknown sender", async () => {
    const session = await manager.resolve("web", "user-1");

    expect(session.channelId).toBe("web");
    expect(session.senderId).toBe("user-1");
    expect(session.conversationId).toBeTruthy();
    expect(session.id).toBeTruthy();
  });

  it("should return the same session for the same sender", async () => {
    const s1 = await manager.resolve("web", "user-1");
    const s2 = await manager.resolve("web", "user-1");

    expect(s1.id).toBe(s2.id);
    expect(s1.conversationId).toBe(s2.conversationId);
  });

  it("should create different sessions for different senders", async () => {
    const s1 = await manager.resolve("web", "user-1");
    const s2 = await manager.resolve("web", "user-2");

    expect(s1.id).not.toBe(s2.id);
    expect(s1.conversationId).not.toBe(s2.conversationId);
  });

  it("should create different sessions for different channels", async () => {
    const s1 = await manager.resolve("web", "user-1");
    const s2 = await manager.resolve("discord", "user-1");

    expect(s1.id).not.toBe(s2.id);
  });

  it("should reset a session with a new conversationId", async () => {
    const original = await manager.resolve("web", "user-1");
    const reset = await manager.reset(original.id);

    expect(reset.id).toBe(original.id);
    expect(reset.conversationId).not.toBe(original.conversationId);
    expect(reset.senderId).toBe(original.senderId);
  });

  it("should throw when resetting non-existent session", async () => {
    await expect(manager.reset("nonexistent")).rejects.toThrow("Session not found");
  });

  it("should get a session by id", async () => {
    const session = await manager.resolve("web", "user-1");
    const found = await manager.get(session.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(session.id);
  });

  it("should return null for unknown session id", async () => {
    const found = await manager.get("nonexistent");
    expect(found).toBeNull();
  });

  it("should update lastActiveAt on touch", async () => {
    const session = await manager.resolve("web", "user-1");
    const originalTime = session.lastActiveAt;

    await new Promise((r) => setTimeout(r, 5));
    await manager.touch(session.id);

    const updated = await manager.get(session.id);
    expect(updated!.lastActiveAt).toBeGreaterThan(originalTime);
  });
});
