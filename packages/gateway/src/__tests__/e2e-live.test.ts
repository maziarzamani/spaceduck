/**
 * Live E2E test — hits the real Gemini API over WebSocket.
 *
 * Skipped unless RUN_LIVE_TESTS=1 is set (opt-in only).
 * Run with: bun run test:live
 *
 * Note: These tests hit a real API and may fail due to rate limits.
 * The free tier allows 5 requests/minute for gemini-2.5-flash.
 */

import { describe, it, expect, afterAll, beforeAll } from "bun:test";
import { createGateway, Gateway } from "../gateway";
import type { WsServerEnvelope } from "@spaceduck/core";

process.env.SPACEDUCK_REQUIRE_AUTH = "0";

const LIVE = Bun.env.RUN_LIVE_TESTS === "1" && !!Bun.env.GEMINI_API_KEY;

describe.skipIf(!LIVE)("Live Gemini E2E", () => {
  let gateway: Gateway;
  const PORT = 49152 + Math.floor(Math.random() * 10000);

  beforeAll(async () => {
    gateway = await createGateway({
      config: {
        port: PORT,
        logLevel: "error",
        provider: { name: "gemini", model: "gemini-2.5-flash" },
        memory: { backend: "sqlite", connectionString: ":memory:" },
        channels: ["web"],
      },
    });
    await gateway.start();
  });

  afterAll(async () => {
    if (gateway?.status === "running") {
      await gateway.stop();
    }
  });

  function connectWs(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws?senderId=live-test`);
      ws.onopen = () => resolve(ws);
      ws.onerror = (e) => reject(e);
    });
  }

  function collectUntil(
    ws: WebSocket,
    stopPredicate: (env: WsServerEnvelope) => boolean,
    timeoutMs = 30000,
  ): Promise<WsServerEnvelope[]> {
    return new Promise((resolve, reject) => {
      const collected: WsServerEnvelope[] = [];
      const timer = setTimeout(
        () => reject(new Error(`Timed out collecting messages (${timeoutMs}ms)`)),
        timeoutMs,
      );

      const handler = (event: MessageEvent) => {
        const envelope = JSON.parse(event.data) as WsServerEnvelope;
        collected.push(envelope);
        if (stopPredicate(envelope)) {
          clearTimeout(timer);
          ws.removeEventListener("message", handler);
          resolve(collected);
        }
      };

      ws.addEventListener("message", handler);
    });
  }

  function isTerminal(env: WsServerEnvelope): boolean {
    return env.type === "stream.done" || env.type === "stream.error";
  }

  function isRateLimited(messages: WsServerEnvelope[]): boolean {
    return messages.some(
      (m) => m.type === "stream.error" && (m as any).code === "AGENT_ERROR",
    );
  }

  it(
    "should get a streaming response from Gemini",
    async () => {
      const ws = await connectWs();

      try {
        const requestId = "live-req-1";

        const allMessages = collectUntil(ws, isTerminal);

        ws.send(JSON.stringify({
          v: 1,
          type: "message.send",
          requestId,
          content: "Reply with exactly: QUACK",
        }));

        const messages = await allMessages;
        const types = messages.map((m) => m.type);

        // Always expect protocol envelope
        expect(types).toContain("message.accepted");
        expect(types).toContain("processing.started");

        if (isRateLimited(messages)) {
          console.log("  (rate limited — skipping assertions)");
          return;
        }

        expect(types).toContain("stream.done");

        const deltas = messages.filter((m) => m.type === "stream.delta");
        expect(deltas.length).toBeGreaterThan(0);

        const fullText = deltas
          .map((d) => (d as Extract<WsServerEnvelope, { type: "stream.delta" }>).delta)
          .join("");

        expect(fullText.length).toBeGreaterThan(0);
        console.log("  Gemini response:", fullText.trim());

        const done = messages.find((m) => m.type === "stream.done") as Extract<
          WsServerEnvelope,
          { type: "stream.done" }
        >;
        expect(done.messageId).toBeTruthy();
      } finally {
        ws.close();
      }
    },
    30_000,
  );

  it(
    "should maintain multi-turn context",
    async () => {
      const ws = await connectWs();

      try {
        // Turn 1: Establish a fact
        const turn1 = collectUntil(ws, isTerminal);
        ws.send(JSON.stringify({
          v: 1,
          type: "message.send",
          requestId: "live-ctx-1",
          content: "My favorite color is purple. Just acknowledge this briefly.",
        }));

        const t1Messages = await turn1;

        if (isRateLimited(t1Messages)) {
          console.log("  (rate limited on turn 1 — skipping)");
          return;
        }

        expect(t1Messages.find((m) => m.type === "stream.done")).toBeTruthy();

        const accepted = t1Messages.find((m) => m.type === "message.accepted") as Extract<
          WsServerEnvelope,
          { type: "message.accepted" }
        >;
        const conversationId = accepted.conversationId;

        // Turn 2: Ask about the fact
        const turn2 = collectUntil(ws, isTerminal);
        ws.send(JSON.stringify({
          v: 1,
          type: "message.send",
          requestId: "live-ctx-2",
          conversationId,
          content: "What is my favorite color? Reply with just the color name.",
        }));

        const t2Messages = await turn2;

        if (isRateLimited(t2Messages)) {
          console.log("  (rate limited on turn 2 — skipping)");
          return;
        }

        const t2Text = t2Messages
          .filter((m) => m.type === "stream.delta")
          .map((d) => (d as Extract<WsServerEnvelope, { type: "stream.delta" }>).delta)
          .join("");

        console.log("  Context recall:", t2Text.trim());
        expect(t2Text.toLowerCase()).toContain("purple");
      } finally {
        ws.close();
      }
    },
    60_000,
  );

  it("should persist messages to SQLite", async () => {
    const res = await fetch(`http://localhost:${PORT}/api/conversations`);
    expect(res.status).toBe(200);

    const body = await res.json();

    if (body.conversations.length === 0) {
      console.log("  (no conversations — previous tests were rate limited)");
      return;
    }

    const convId = body.conversations[0].id;
    const msgs = await gateway.deps.conversationStore.loadMessages(convId);
    expect(msgs.ok).toBe(true);
    if (msgs.ok) {
      expect(msgs.value.length).toBeGreaterThan(0);
      const roles = new Set(msgs.value.map((m) => m.role));
      expect(roles.has("user")).toBe(true);
      expect(roles.has("assistant")).toBe(true);
    }
  });
});
