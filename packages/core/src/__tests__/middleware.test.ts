import { describe, it, expect } from "bun:test";
import { composeMiddleware, type MessageContext, type Middleware } from "../middleware";
import { createMessage } from "../__fixtures__/messages";

function createContext(overrides?: Partial<MessageContext>): MessageContext {
  return {
    conversationId: "conv-1",
    message: createMessage(),
    metadata: {},
    ...overrides,
  };
}

describe("composeMiddleware", () => {
  it("should call middlewares in order", async () => {
    const order: number[] = [];

    const mw1: Middleware = async (ctx, next) => {
      order.push(1);
      await next();
      order.push(4);
    };
    const mw2: Middleware = async (ctx, next) => {
      order.push(2);
      await next();
      order.push(3);
    };

    const composed = composeMiddleware([mw1, mw2]);
    const ctx = createContext();

    await composed(ctx, async () => {
      order.push(99);
    });

    expect(order).toEqual([1, 2, 99, 3, 4]);
  });

  it("should throw if next() called multiple times", async () => {
    const mw: Middleware = async (_ctx, next) => {
      await next();
      await next(); // second call should throw
    };

    const composed = composeMiddleware([mw]);

    await expect(composed(createContext(), async () => {})).rejects.toThrow(
      "next() called multiple times",
    );
  });

  it("should allow middleware to modify context metadata", async () => {
    const mw: Middleware = async (ctx, next) => {
      ctx.metadata.startTime = Date.now();
      await next();
      ctx.metadata.endTime = Date.now();
    };

    const composed = composeMiddleware([mw]);
    const ctx = createContext();
    await composed(ctx, async () => {});

    expect(ctx.metadata.startTime).toBeDefined();
    expect(ctx.metadata.endTime).toBeDefined();
  });

  it("should propagate errors from inner middleware", async () => {
    const mw: Middleware = async (_ctx, next) => {
      await next();
    };

    const composed = composeMiddleware([mw]);

    await expect(
      composed(createContext(), async () => {
        throw new Error("inner error");
      }),
    ).rejects.toThrow("inner error");
  });

  it("should work with empty middleware array", async () => {
    const composed = composeMiddleware([]);
    let called = false;

    await composed(createContext(), async () => {
      called = true;
    });

    expect(called).toBe(true);
  });
});
