import { describe, test, expect, mock } from "bun:test";
import type { Logger, ChannelMessage } from "@spaceduck/core";

// WhatsApp channel depends heavily on Baileys which requires filesystem + network.
// We test the public API surface (lifecycle, message buffering, presence) with
// a minimal mock of the socket layer.

const mockLogger: Logger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => mockLogger,
} as any;

// Mock Baileys to avoid filesystem/network dependency
const mockSendMessage = mock(() => Promise.resolve({ key: { id: "sent-1" } }));
const mockSendPresenceUpdate = mock(() => Promise.resolve());
const mockEnd = mock(() => {});
const mockEvProcess = mock(() => {});

mock.module("@whiskeysockets/baileys", () => ({
  default: () => ({
    sendMessage: mockSendMessage,
    sendPresenceUpdate: mockSendPresenceUpdate,
    end: mockEnd,
    ev: { process: mockEvProcess },
    user: { id: "12345:0@s.whatsapp.net" },
  }),
  useMultiFileAuthState: () =>
    Promise.resolve({
      state: { creds: {}, keys: {} },
      saveCreds: () => Promise.resolve(),
    }),
  makeCacheableSignalKeyStore: (keys: unknown) => keys,
  fetchLatestBaileysVersion: () => Promise.resolve({ version: [2, 2413, 1] }),
  DisconnectReason: { loggedOut: 401 },
  isJidBroadcast: () => false,
  isJidGroup: () => false,
  isJidNewsletter: () => false,
  isJidStatusBroadcast: () => false,
  proto: { Message: { create: () => ({}) } },
}));

mock.module("qrcode-terminal", () => ({
  default: { generate: () => {} },
}));

mock.module("fs", () => ({
  mkdirSync: () => {},
}));

const { WhatsAppChannel } = await import("../whatsapp-channel");

describe("WhatsAppChannel", () => {
  test("initializes with correct defaults", () => {
    const channel = new WhatsAppChannel({ logger: mockLogger });
    expect(channel.name).toBe("whatsapp");
    expect(channel.status).toBe("stopped");
  });

  test("uses custom authDir", () => {
    const channel = new WhatsAppChannel({
      logger: mockLogger,
      authDir: "/custom/auth",
    });
    expect((channel as any).authDir).toBe("/custom/auth");
  });

  test("onMessage registers a handler", () => {
    const channel = new WhatsAppChannel({ logger: mockLogger });
    const handler = async (_msg: ChannelMessage) => {};
    channel.onMessage(handler);
    expect((channel as any).messageHandler).toBe(handler);
  });

  test("sendDelta buffers text per sender+requestId", async () => {
    const channel = new WhatsAppChannel({ logger: mockLogger });
    const response = { requestId: "req-1" } as any;

    await channel.sendDelta("sender1", "Hello ", response);
    await channel.sendDelta("sender1", "world", response);

    const buffers = (channel as any).responseBuffers;
    expect(buffers.get("sender1:req-1")).toBe("Hello world");
  });

  test("sendDelta buffers independently per requestId", async () => {
    const channel = new WhatsAppChannel({ logger: mockLogger });

    await channel.sendDelta("s1", "A", { requestId: "r1" } as any);
    await channel.sendDelta("s1", "B", { requestId: "r2" } as any);

    const buffers = (channel as any).responseBuffers;
    expect(buffers.get("s1:r1")).toBe("A");
    expect(buffers.get("s1:r2")).toBe("B");
  });

  test("sendError cleans up buffer", async () => {
    const channel = new WhatsAppChannel({ logger: mockLogger });
    const response = { requestId: "req-err" } as any;

    await channel.sendDelta("s1", "partial", response);

    // sendError calls send() internally which needs a socket, so we expect it to throw.
    // But the buffer should still be cleaned up before the send attempt.
    const buffers = (channel as any).responseBuffers;
    expect(buffers.has("s1:req-err")).toBe(true);

    // After sendError, the buffer key is deleted before send is called
    try {
      await channel.sendError("s1", "ERR", "Something failed", response);
    } catch {
      // Expected — socket is not connected
    }
    expect(buffers.has("s1:req-err")).toBe(false);
  });

  test("stop cleans up state", async () => {
    const channel = new WhatsAppChannel({ logger: mockLogger });

    // Simulate some buffered state
    (channel as any).responseBuffers.set("k1", "v1");
    (channel as any).sentMessageIds.add("msg-1");
    (channel as any)._status = "running";

    await channel.stop();

    expect(channel.status).toBe("stopped");
    expect((channel as any).responseBuffers.size).toBe(0);
    expect((channel as any).sentMessageIds.size).toBe(0);
  });

  test("stop is idempotent when already stopped", async () => {
    const channel = new WhatsAppChannel({ logger: mockLogger });
    expect(channel.status).toBe("stopped");
    await channel.stop();
    expect(channel.status).toBe("stopped");
  });

  test("start is idempotent when already running", async () => {
    const channel = new WhatsAppChannel({ logger: mockLogger });
    (channel as any)._status = "running";
    await channel.start();
    expect(channel.status).toBe("running");
  });

  test("toPhoneJid returns non-LID jids as-is", () => {
    const channel = new WhatsAppChannel({ logger: mockLogger });
    const result = (channel as any).toPhoneJid("12345@s.whatsapp.net");
    expect(result).toBe("12345@s.whatsapp.net");
  });
});
