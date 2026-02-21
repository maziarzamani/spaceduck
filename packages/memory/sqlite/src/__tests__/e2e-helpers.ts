/**
 * Shared helpers for live E2E memory tests.
 */

import { Database } from "bun:sqlite";

export const DB_PATH = process.env.DB_PATH ?? "./data/spaceduck.db";
export const WS_URL = process.env.WS_URL ?? "ws://localhost:3000/ws";
export const WAIT_MS = 6000;

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function sendMessage(text: string, conversationId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let response = "";
    const requestId = `req-${Date.now().toString(36)}`;
    const timeout = setTimeout(() => {
      ws.close();
      resolve(response || "(timeout — no response)");
    }, 90_000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        v: 1,
        type: "message.send",
        requestId,
        content: text,
        conversationId,
      }));
    };
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data as string);
        if (d.type === "stream.delta") response += d.delta;
        if (d.type === "stream.done" || d.type === "stream.error" || d.type === "error") {
          clearTimeout(timeout);
          ws.close();
          resolve(response || JSON.stringify(d));
        }
      } catch {}
    };
    ws.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${e}`));
    };
  });
}

export interface FactRow {
  id: string;
  slot: string | null;
  slot_value: string | null;
  content: string;
  is_active: number;
  source: string;
}

export function queryFacts(db: Database, where: string, params?: any[]): FactRow[] {
  const sql = `SELECT id, slot, slot_value, content, is_active, source FROM facts WHERE ${where} ORDER BY created_at DESC`;
  return (params ? db.query(sql).all(...params) : db.query(sql).all()) as FactRow[];
}

export function activeFacts(db: Database): FactRow[] {
  return queryFacts(db, "is_active = 1");
}

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

export class TestRunner {
  readonly results: TestResult[] = [];
  private readonly convPrefix: string;
  private convN = 0;

  constructor(readonly suiteName: string) {
    this.convPrefix = `e2e-${Date.now().toString(36)}`;
  }

  nextConv() { return `${this.convPrefix}-${++this.convN}`; }

  assert(name: string, pass: boolean, detail: string) {
    this.results.push({ name, pass, detail });
    const icon = pass ? "✅" : "❌";
    console.log(`${icon} ${name}: ${detail}`);
  }

  cleanup(db: Database) {
    db.run("DELETE FROM facts WHERE conversation_id LIKE ?", [`${this.convPrefix}%`]);
  }

  summary(): boolean {
    const passed = this.results.filter((r) => r.pass).length;
    const total = this.results.length;
    console.log("\n═══════════════════════════════════════════");
    console.log(`  ${this.suiteName}: ${passed}/${total} passed`);
    console.log("═══════════════════════════════════════════");
    for (const r of this.results) {
      console.log(`  ${r.pass ? "✅" : "❌"} ${r.name}`);
    }
    console.log("");
    return passed === total;
  }
}
