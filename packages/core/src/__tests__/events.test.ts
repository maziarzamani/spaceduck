import { describe, it, expect, beforeEach } from "bun:test";
import { SimpleEventBus } from "../events";
import { ConsoleLogger } from "../types/logger";

describe("SimpleEventBus", () => {
  let bus: SimpleEventBus;

  beforeEach(() => {
    bus = new SimpleEventBus(new ConsoleLogger("error"));
  });

  it("should call registered handlers on emit", () => {
    const received: unknown[] = [];
    bus.on("message:received", (data) => { received.push(data); });

    bus.emit("message:received", {
      conversationId: "conv-1",
      message: { id: "1", role: "user", content: "hello", timestamp: Date.now() },
    });

    expect(received).toHaveLength(1);
    expect((received[0] as { conversationId: string }).conversationId).toBe("conv-1");
  });

  it("should support multiple handlers per event", () => {
    let count = 0;
    bus.on("message:received", () => { count++; });
    bus.on("message:received", () => { count++; });

    bus.emit("message:received", {
      conversationId: "conv-1",
      message: { id: "1", role: "user", content: "hello", timestamp: Date.now() },
    });

    expect(count).toBe(2);
  });

  it("should not call handlers after off()", () => {
    let count = 0;
    const handler = () => { count++; };
    bus.on("message:received", handler);
    bus.off("message:received", handler);

    bus.emit("message:received", {
      conversationId: "conv-1",
      message: { id: "1", role: "user", content: "hello", timestamp: Date.now() },
    });

    expect(count).toBe(0);
  });

  it("should not throw when sync handler throws (fire-and-forget)", () => {
    bus.on("error", () => {
      throw new Error("listener boom");
    });

    expect(() => {
      bus.emit("error", {
        error: new Error("test") as any,
        context: "test",
      });
    }).not.toThrow();
  });

  it("should await all handlers in emitAsync", async () => {
    const order: number[] = [];

    bus.on("message:response", async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(1);
    });
    bus.on("message:response", async () => {
      order.push(2);
    });

    await bus.emitAsync("message:response", {
      conversationId: "conv-1",
      message: { id: "1", role: "assistant", content: "hi", timestamp: Date.now() },
      durationMs: 100,
    });

    expect(order).toContain(1);
    expect(order).toContain(2);
  });

  it("should not throw from emitAsync when listener fails", async () => {
    bus.on("error", async () => {
      throw new Error("async boom");
    });

    await expect(
      bus.emitAsync("error", {
        error: new Error("test") as any,
        context: "test",
      }),
    ).resolves.toBeUndefined();
  });
});
