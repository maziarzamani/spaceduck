// Middleware pipeline for pre/post-processing messages

import type { Message } from "./types";

export interface MessageContext {
  conversationId: string;
  message: Message;
  response?: AsyncIterable<unknown>;
  metadata: Record<string, unknown>;
}

export type Middleware = (
  ctx: MessageContext,
  next: () => Promise<void>,
) => Promise<void>;

/**
 * Compose an array of middlewares into a single middleware.
 * Uses Koa-style onion model with once-next guard.
 */
export function composeMiddleware(middlewares: Middleware[]): Middleware {
  return async (ctx, next) => {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;

      const fn = i === middlewares.length ? next : middlewares[i];

      try {
        await fn(ctx, () => dispatch(i + 1));
      } catch (err) {
        // If this is the user's `next` (the innermost handler), rethrow
        if (i === middlewares.length) throw err;
        // Otherwise, middleware errors propagate up the chain
        throw err;
      }
    };

    await dispatch(0);
  };
}
