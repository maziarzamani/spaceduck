import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createGateway, Gateway } from "../gateway";
import type { Message, Provider, ProviderChunk } from "@spaceduck/core";
import {
  hashToken,
  createPairingSession,
  confirmPairing,
  verifyToken,
  revokeToken,
  listTokens,
  ensureGatewaySettings,
  getActivePairingCode,
} from "../auth";
import { Database } from "bun:sqlite";
import { SchemaManager, ensureCustomSQLite } from "@spaceduck/memory-sqlite";
import { ConsoleLogger } from "@spaceduck/core";

class StubProvider implements Provider {
  readonly name = "stub";
  async *chat(): AsyncIterable<ProviderChunk> {
    yield { type: "text", text: "ok" };
  }
}

function createTestDb(): Database {
  ensureCustomSQLite();
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  const logger = new ConsoleLogger("error");
  const schema = new SchemaManager(db, logger);
  schema.loadExtensions();
  // Run migrations synchronously by awaiting
  return db;
}

async function createTestDbWithMigrations(): Promise<Database> {
  ensureCustomSQLite();
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  const logger = new ConsoleLogger("error");
  const schema = new SchemaManager(db, logger);
  schema.loadExtensions();
  await schema.migrate();
  return db;
}

describe("Auth module — unit tests", () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDbWithMigrations();
    ensureGatewaySettings(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("gateway settings", () => {
    it("creates settings on first call, returns same on second", () => {
      const first = ensureGatewaySettings(db);
      const second = ensureGatewaySettings(db);
      expect(first.gatewayId).toBe(second.gatewayId);
      expect(first.gatewayName).toBe(second.gatewayName);
      expect(first.gatewayId).toBeTruthy();
    });
  });

  describe("pairing", () => {
    it("creates a session with 6-digit code", () => {
      const session = createPairingSession(db);
      expect(session.pairingId).toBeTruthy();
      expect(session.code).toMatch(/^\d{6}$/);
      expect(session.expiresAt).toBeGreaterThan(Date.now());
    });

    it("getActivePairingCode returns the latest code", () => {
      const session = createPairingSession(db);
      const code = getActivePairingCode(db);
      expect(code).toBe(session.code);
    });

    it("confirm with correct code returns token", () => {
      const session = createPairingSession(db);
      const result = confirmPairing(db, session.pairingId, session.code, "Test Device");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.token).toBeTruthy();
        expect(result.result.token.length).toBeGreaterThanOrEqual(32);
        expect(result.result.gatewayId).toBeTruthy();
        expect(result.result.gatewayName).toBeTruthy();
      }
    });

    it("confirm with wrong code returns wrong_code", () => {
      const session = createPairingSession(db);
      const result = confirmPairing(db, session.pairingId, "000000");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("wrong_code");
    });

    it("confirm with expired session returns expired", () => {
      const session = createPairingSession(db);
      db.run("UPDATE pairing_sessions SET expires_at = ? WHERE id = ?", [
        Date.now() - 1000,
        session.pairingId,
      ]);
      const result = confirmPairing(db, session.pairingId, session.code);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("expired");
    });

    it("confirm with unknown pairingId returns not_found", () => {
      const result = confirmPairing(db, "nonexistent", "123456");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("not_found");
    });

    it("rate limits after 5 wrong attempts", () => {
      const session = createPairingSession(db);
      for (let i = 0; i < 5; i++) {
        const r = confirmPairing(db, session.pairingId, "000000");
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe("wrong_code");
      }
      const final = confirmPairing(db, session.pairingId, session.code);
      expect(final.ok).toBe(false);
      if (!final.ok) expect(final.error).toBe("rate_limited");
    });

    it("cannot reuse a consumed pairing session", () => {
      const session = createPairingSession(db);
      const first = confirmPairing(db, session.pairingId, session.code);
      expect(first.ok).toBe(true);
      const second = confirmPairing(db, session.pairingId, session.code);
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error).toBe("already_used");
    });
  });

  describe("token verification", () => {
    it("verifies a valid token", () => {
      const session = createPairingSession(db);
      const result = confirmPairing(db, session.pairingId, session.code, "My Device");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const token = verifyToken(db, result.result.token);
      expect(token).not.toBeNull();
      expect(token!.deviceName).toBe("My Device");
    });

    it("rejects an unknown token", () => {
      const token = verifyToken(db, "totally-fake-token");
      expect(token).toBeNull();
    });

    it("rejects a revoked token", () => {
      const session = createPairingSession(db);
      const result = confirmPairing(db, session.pairingId, session.code);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const verified = verifyToken(db, result.result.token);
      expect(verified).not.toBeNull();

      revokeToken(db, verified!.id);

      const afterRevoke = verifyToken(db, result.result.token);
      expect(afterRevoke).toBeNull();
    });

    it("updates lastUsedAt on verification", () => {
      const session = createPairingSession(db);
      const result = confirmPairing(db, session.pairingId, session.code);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const before = verifyToken(db, result.result.token);
      expect(before).not.toBeNull();
      const firstLastUsed = before!.lastUsedAt;

      // Small delay to ensure different timestamp
      const after = verifyToken(db, result.result.token);
      expect(after).not.toBeNull();
      expect(after!.lastUsedAt).toBeGreaterThanOrEqual(firstLastUsed ?? 0);
    });
  });

  describe("token listing and revocation", () => {
    it("lists active tokens", () => {
      const s1 = createPairingSession(db);
      confirmPairing(db, s1.pairingId, s1.code, "Device A");
      const s2 = createPairingSession(db);
      confirmPairing(db, s2.pairingId, s2.code, "Device B");

      const tokens = listTokens(db);
      expect(tokens).toHaveLength(2);
      const names = tokens.map((t) => t.deviceName);
      expect(names).toContain("Device A");
      expect(names).toContain("Device B");
    });

    it("revoke removes token from active list", () => {
      const s1 = createPairingSession(db);
      const r1 = confirmPairing(db, s1.pairingId, s1.code, "Revoke Me");
      expect(r1.ok).toBe(true);
      if (!r1.ok) return;

      const verified = verifyToken(db, r1.result.token);
      expect(verified).not.toBeNull();
      revokeToken(db, verified!.id);

      const tokens = listTokens(db);
      const names = tokens.map((t) => t.deviceName);
      expect(names).not.toContain("Revoke Me");
    });
  });

  describe("hashToken", () => {
    it("produces consistent SHA-256 hex", () => {
      const h1 = hashToken("test-token");
      const h2 = hashToken("test-token");
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(64); // SHA-256 hex
    });

    it("produces different hashes for different inputs", () => {
      expect(hashToken("a")).not.toBe(hashToken("b"));
    });
  });
});

describe("Auth HTTP endpoints", () => {
  let gateway: Gateway;
  const PORT = 49200 + Math.floor(Math.random() * 10000);

  async function createTestGateway(authRequired = true): Promise<Gateway> {
    process.env.SPACEDUCK_REQUIRE_AUTH = authRequired ? "1" : "0";
    const provider = new StubProvider();
    const gw = await createGateway({
      provider,
      config: {
        port: PORT,
        logLevel: "error",
        provider: { name: "stub", model: "test" },
        memory: { backend: "sqlite", connectionString: ":memory:" },
        channels: ["web"],
      },
    });
    return gw;
  }

  afterEach(async () => {
    if (gateway?.status === "running") {
      await gateway.stop();
    }
    delete process.env.SPACEDUCK_REQUIRE_AUTH;
  });

  it("GET /api/gateway/public-info returns gateway details without auth", async () => {
    gateway = await createTestGateway();
    await gateway.start();

    const res = await fetch(`http://localhost:${PORT}/api/gateway/public-info`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.gatewayId).toBeTruthy();
    expect(body.gatewayName).toBeTruthy();
    expect(body.requiresAuth).toBe(true);
    expect(body.wsPath).toBe("/ws");
  });

  it("pairing flow: start -> confirm -> use token", async () => {
    gateway = await createTestGateway();
    await gateway.start();

    // Start pairing
    const startRes = await fetch(`http://localhost:${PORT}/api/pair/start`, { method: "POST" });
    expect(startRes.status).toBe(200);
    const startBody = await startRes.json() as { pairingId: string; codeHint: string };
    expect(startBody.pairingId).toBeTruthy();

    // Get code from /pair page (it's in the HTML)
    const pairPageRes = await fetch(`http://localhost:${PORT}/pair`);
    expect(pairPageRes.status).toBe(200);
    const html = await pairPageRes.text();
    const codeMatch = html.match(/<div class="code"[^>]*>(\d{6})<\/div>/);
    expect(codeMatch).toBeTruthy();
    const code = codeMatch![1];

    // Confirm pairing
    const confirmRes = await fetch(`http://localhost:${PORT}/api/pair/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingId: startBody.pairingId, code, deviceName: "Test" }),
    });
    expect(confirmRes.status).toBe(200);
    const confirmBody = await confirmRes.json() as { token: string; gatewayId: string };
    expect(confirmBody.token).toBeTruthy();
    expect(confirmBody.gatewayId).toBeTruthy();

    // Use token on protected endpoint
    const infoRes = await fetch(`http://localhost:${PORT}/api/gateway/info`, {
      headers: { authorization: `Bearer ${confirmBody.token}` },
    });
    expect(infoRes.status).toBe(200);

    // Without token, protected endpoint returns 401
    const noAuthRes = await fetch(`http://localhost:${PORT}/api/gateway/info`);
    expect(noAuthRes.status).toBe(401);
  });

  it("rejects wrong pairing code", async () => {
    gateway = await createTestGateway();
    await gateway.start();

    const startRes = await fetch(`http://localhost:${PORT}/api/pair/start`, { method: "POST" });
    const { pairingId } = await startRes.json() as { pairingId: string };

    const confirmRes = await fetch(`http://localhost:${PORT}/api/pair/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingId, code: "000000" }),
    });
    expect(confirmRes.status).toBe(401);
  });

  it("token listing and revocation", async () => {
    gateway = await createTestGateway();
    await gateway.start();

    // Pair a device
    const startRes = await fetch(`http://localhost:${PORT}/api/pair/start`, { method: "POST" });
    const { pairingId } = await startRes.json() as { pairingId: string };
    const pairPage = await fetch(`http://localhost:${PORT}/pair`);
    const html = await pairPage.text();
    const code = html.match(/<div class="code"[^>]*>(\d{6})<\/div>/)![1];

    const confirmRes = await fetch(`http://localhost:${PORT}/api/pair/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingId, code, deviceName: "ToRevoke" }),
    });
    const { token } = await confirmRes.json() as { token: string };

    // List tokens
    const listRes = await fetch(`http://localhost:${PORT}/api/tokens`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { tokens: Array<{ id: string; deviceName: string; isCurrent: boolean }> };
    expect(listBody.tokens).toHaveLength(1);
    expect(listBody.tokens[0].deviceName).toBe("ToRevoke");
    expect(listBody.tokens[0].isCurrent).toBe(true);

    // Revoke
    const revokeRes = await fetch(`http://localhost:${PORT}/api/tokens/revoke`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(revokeRes.status).toBe(200);

    // Token no longer works
    const afterRevoke = await fetch(`http://localhost:${PORT}/api/gateway/info`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterRevoke.status).toBe(401);
  });

  it("REQUIRE_AUTH=0 skips auth checks", async () => {
    gateway = await createTestGateway(false);
    await gateway.start();

    const publicInfo = await fetch(`http://localhost:${PORT}/api/gateway/public-info`);
    const body = await publicInfo.json() as Record<string, unknown>;
    expect(body.requiresAuth).toBe(false);

    // Protected endpoint works without token
    const infoRes = await fetch(`http://localhost:${PORT}/api/gateway/info`);
    expect(infoRes.status).toBe(200);
  });
});
