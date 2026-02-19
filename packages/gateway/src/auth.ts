import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";

const PAIRING_CODE_LENGTH = 6;
const PAIRING_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PAIRING_ATTEMPTS = 5;

export interface GatewayInfo {
  gatewayId: string;
  gatewayName: string;
}

export interface PairingSession {
  pairingId: string;
  code: string;
  expiresAt: number;
}

export interface AuthToken {
  id: string;
  tokenHash: string;
  deviceName: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface PairingResult {
  token: string;
  gatewayId: string;
  gatewayName: string;
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateCode(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(PAIRING_CODE_LENGTH, "0");
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function ensureGatewaySettings(db: Database): GatewayInfo {
  const existing = db.query("SELECT id, name FROM gateway_settings LIMIT 1").get() as {
    id: string;
    name: string;
  } | null;

  if (existing) {
    return { gatewayId: existing.id, gatewayName: existing.name };
  }

  const id = crypto.randomUUID();
  const name = hostname();
  db.run(
    "INSERT INTO gateway_settings (id, name, created_at) VALUES (?, ?, ?)",
    [id, name, Date.now()],
  );
  return { gatewayId: id, gatewayName: name };
}

export function getGatewayInfo(db: Database): GatewayInfo {
  const row = db.query("SELECT id, name FROM gateway_settings LIMIT 1").get() as {
    id: string;
    name: string;
  } | null;

  if (!row) throw new Error("gateway_settings not initialized");
  return { gatewayId: row.id, gatewayName: row.name };
}

export function createPairingSession(db: Database): PairingSession {
  const pairingId = crypto.randomUUID();
  const code = generateCode();
  const now = Date.now();
  const expiresAt = now + PAIRING_TTL_MS;

  db.run(
    "INSERT INTO pairing_sessions (id, code, expires_at, created_at, attempts) VALUES (?, ?, ?, ?, 0)",
    [pairingId, code, expiresAt, now],
  );

  return { pairingId, code, expiresAt };
}

export function getActivePairingCode(db: Database): string | null {
  const row = db.query(
    "SELECT code FROM pairing_sessions WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
  ).get(Date.now()) as { code: string } | null;

  return row?.code ?? null;
}

export type ConfirmResult =
  | { ok: true; result: PairingResult }
  | { ok: false; error: "not_found" | "expired" | "already_used" | "rate_limited" | "wrong_code" };

export function confirmPairing(
  db: Database,
  pairingId: string,
  code: string,
  deviceName?: string,
): ConfirmResult {
  const session = db.query(
    "SELECT code, expires_at, used_at, attempts FROM pairing_sessions WHERE id = ?",
  ).get(pairingId) as {
    code: string;
    expires_at: number;
    used_at: number | null;
    attempts: number;
  } | null;

  if (!session) return { ok: false, error: "not_found" };
  if (session.used_at) return { ok: false, error: "already_used" };
  if (session.expires_at < Date.now()) return { ok: false, error: "expired" };
  if (session.attempts >= MAX_PAIRING_ATTEMPTS) return { ok: false, error: "rate_limited" };

  if (session.code !== code) {
    db.run(
      "UPDATE pairing_sessions SET attempts = attempts + 1 WHERE id = ?",
      [pairingId],
    );
    return { ok: false, error: "wrong_code" };
  }

  db.run("UPDATE pairing_sessions SET used_at = ? WHERE id = ?", [Date.now(), pairingId]);

  const rawToken = generateToken();
  const tokenId = crypto.randomUUID();
  const tokenH = hashToken(rawToken);
  const now = Date.now();

  db.run(
    "INSERT INTO auth_tokens (id, token_hash, device_name, created_at) VALUES (?, ?, ?, ?)",
    [tokenId, tokenH, deviceName ?? null, now],
  );

  const info = getGatewayInfo(db);

  return {
    ok: true,
    result: {
      token: rawToken,
      gatewayId: info.gatewayId,
      gatewayName: info.gatewayName,
    },
  };
}

export function verifyToken(db: Database, rawToken: string): AuthToken | null {
  const h = hashToken(rawToken);
  const row = db.query(
    "SELECT id, token_hash, device_name, created_at, last_used_at, revoked_at FROM auth_tokens WHERE token_hash = ? AND revoked_at IS NULL",
  ).get(h) as {
    id: string;
    token_hash: string;
    device_name: string | null;
    created_at: number;
    last_used_at: number | null;
    revoked_at: number | null;
  } | null;

  if (!row) return null;

  db.run("UPDATE auth_tokens SET last_used_at = ? WHERE id = ?", [Date.now(), row.id]);

  return {
    id: row.id,
    tokenHash: row.token_hash,
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export function revokeToken(db: Database, tokenId: string): boolean {
  const result = db.run(
    "UPDATE auth_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    [Date.now(), tokenId],
  );
  return result.changes > 0;
}

export function listTokens(db: Database): AuthToken[] {
  const rows = db.query(
    "SELECT id, token_hash, device_name, created_at, last_used_at, revoked_at FROM auth_tokens WHERE revoked_at IS NULL ORDER BY last_used_at DESC",
  ).all() as Array<{
    id: string;
    token_hash: string;
    device_name: string | null;
    created_at: number;
    last_used_at: number | null;
    revoked_at: number | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    tokenHash: r.token_hash,
    deviceName: r.device_name,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
  }));
}

/**
 * Extract Bearer token from request. Checks Authorization header first,
 * falls back to ?token= query param (for WebSocket browser compat).
 */
export function extractToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  const url = new URL(req.url);
  return url.searchParams.get("token");
}

/**
 * Auth middleware: returns the verified token row, or null if auth fails.
 * When SPACEDUCK_REQUIRE_AUTH=0, always returns a synthetic token (auth skipped).
 */
export function requireAuth(
  req: Request,
  db: Database,
  authRequired: boolean,
): AuthToken | null {
  if (!authRequired) {
    return {
      id: "dev-bypass",
      tokenHash: "",
      deviceName: "auth-disabled",
      createdAt: 0,
      lastUsedAt: null,
      revokedAt: null,
    };
  }

  const raw = extractToken(req);
  if (!raw) return null;

  return verifyToken(db, raw);
}
