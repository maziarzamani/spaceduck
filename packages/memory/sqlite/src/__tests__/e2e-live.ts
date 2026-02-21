#!/usr/bin/env bun
/**
 * Live E2E: English memory pipeline.
 *
 * Tests: name recall, correction, contamination guard, location, "moved to",
 * combined recall.
 *
 * Usage:
 *   bun packages/memory/sqlite/src/__tests__/e2e-live.ts
 */

import { Database } from "bun:sqlite";
import {
  DB_PATH, WAIT_MS, sleep, sendMessage, queryFacts, TestRunner,
} from "./e2e-helpers";

const t = new TestRunner("English E2E");
const db = new Database(DB_PATH);

console.log(`\n🔧 ${t.suiteName}`);
console.log(`   DB: ${DB_PATH}\n`);

// ── Setup: seed name=John via chat (so it gets embedded) ────────────────

console.log("── Setup: seed via chat ──");
const respSetup = await sendMessage("My name is John", t.nextConv());
console.log(`   LLM: ${respSetup.slice(0, 150)}`);
await sleep(WAIT_MS);

const seedCheck = queryFacts(db, "slot = 'name' AND slot_value = 'John' AND is_active = 1");
t.assert("S0: John seeded via chat", seedCheck.length >= 1, seedCheck.length >= 1 ? "OK" : "Seed failed");

// ── T1: Name recall ─────────────────────────────────────────────────────

console.log("\n── T1: Name recall ──");
const resp1 = await sendMessage("What is my name?", t.nextConv());
console.log(`   LLM: ${resp1.slice(0, 200)}`);
await sleep(WAIT_MS);

const poison1 = queryFacts(db, "slot_value = 'unknown' OR content LIKE '%is unknown%'");
t.assert("T1a: Recall mentions John", resp1.toLowerCase().includes("john"),
  resp1.toLowerCase().includes("john") ? "Contains 'john'" : `"${resp1.slice(0, 100)}"`);
t.assert("T1b: No poison facts", poison1.length === 0,
  poison1.length === 0 ? "Clean" : `${poison1.length} poison facts`);

// ── T2: Name correction ─────────────────────────────────────────────────

console.log("\n── T2: Name correction ──");
const resp2 = await sendMessage("Actually, my name is Peter", t.nextConv());
console.log(`   LLM: ${resp2.slice(0, 200)}`);
await sleep(WAIT_MS);

const johnFacts = queryFacts(db, "slot = 'name' AND slot_value = 'John'");
const peterFacts = queryFacts(db, "slot = 'name' AND slot_value = 'Peter' AND is_active = 1");
t.assert("T2a: John deactivated", johnFacts.every((f) => f.is_active === 0),
  johnFacts.every((f) => f.is_active === 0) ? "All inactive" : "Still active!");
t.assert("T2b: Peter active", peterFacts.length >= 1,
  peterFacts.length >= 1 ? `(${peterFacts[0]?.source})` : "Missing");

// ── T3: Recall after correction ─────────────────────────────────────────

console.log("\n── T3: Recall after correction ──");
const resp3 = await sendMessage("What is my name?", t.nextConv());
console.log(`   LLM: ${resp3.slice(0, 200)}`);
await sleep(WAIT_MS);

t.assert("T3: Says Peter, not John",
  resp3.toLowerCase().includes("peter") && !resp3.toLowerCase().includes("john"),
  resp3.toLowerCase().includes("peter") ? "Correct" : `"${resp3.slice(0, 100)}"`);

// ── T4: Assistant contamination guard ────────────────────────────────────

console.log("\n── T4: Contamination guard ──");
const nameBefore = queryFacts(db, "slot = 'name' AND is_active = 1")[0]?.slot_value;
await sleep(WAIT_MS);
const nameAfter = queryFacts(db, "slot = 'name' AND is_active = 1")[0]?.slot_value;
t.assert("T4: Name not corrupted", nameAfter === nameBefore,
  nameAfter === nameBefore ? `Still ${nameBefore}` : `Changed to ${nameAfter}!`);

// ── T5: Location store ──────────────────────────────────────────────────

console.log("\n── T5: Location store ──");
const resp5 = await sendMessage("I live in Copenhagen", t.nextConv());
console.log(`   LLM: ${resp5.slice(0, 200)}`);
await sleep(WAIT_MS);

const locFacts = queryFacts(db, "slot = 'location' AND is_active = 1");
t.assert("T5: Copenhagen stored", locFacts.some((f) => f.slot_value?.includes("Copenhagen")),
  locFacts.length > 0 ? `location=${locFacts[0]?.slot_value}` : "Missing");

// ── T6: Location correction via "moved to" ──────────────────────────────

console.log("\n── T6: 'I moved to Tokyo' ──");
const resp6 = await sendMessage("I moved to Tokyo", t.nextConv());
console.log(`   LLM: ${resp6.slice(0, 200)}`);
await sleep(WAIT_MS);

const cphFacts = queryFacts(db, "slot = 'location' AND slot_value LIKE '%Copenhagen%'");
const tokyoFacts = queryFacts(db, "slot = 'location' AND slot_value LIKE '%Tokyo%' AND is_active = 1");
t.assert("T6a: Copenhagen deactivated", cphFacts.every((f) => f.is_active === 0),
  cphFacts.every((f) => f.is_active === 0) ? "Inactive" : "Still active!");
t.assert("T6b: Tokyo active", tokyoFacts.length >= 1,
  tokyoFacts.length >= 1 ? `(${tokyoFacts[0]?.source})` : "Missing");

// ── T7: Combined recall ─────────────────────────────────────────────────

console.log("\n── T7: Combined recall ──");
const resp7 = await sendMessage("Tell me everything you know about me", t.nextConv());
console.log(`   LLM: ${resp7.slice(0, 300)}`);
await sleep(WAIT_MS);

const r7 = resp7.toLowerCase();
t.assert("T7a: Mentions Peter", r7.includes("peter"), r7.includes("peter") ? "Yes" : "Missing");
t.assert("T7b: Mentions Tokyo", r7.includes("tokyo"), r7.includes("tokyo") ? "Yes" : "Missing");
t.assert("T7c: No stale John", !r7.includes("john"), !r7.includes("john") ? "Clean" : "Leaked!");

// ── Cleanup ─────────────────────────────────────────────────────────────

console.log("\n── Cleanup ──");
t.cleanup(db);
db.close();
console.log("   Done.");

process.exit(t.summary() ? 0 : 1);
