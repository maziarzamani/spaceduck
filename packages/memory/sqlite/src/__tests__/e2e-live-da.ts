#!/usr/bin/env bun
/**
 * Live E2E: Danish & multilingual memory pipeline.
 *
 * Tests: Danish name/location/age extraction, language switching,
 * cross-language slot supersession, "flyttet til" pattern.
 *
 * Usage:
 *   bun packages/memory/sqlite/src/__tests__/e2e-live-da.ts
 */

import { Database } from "bun:sqlite";
import {
  DB_PATH, WAIT_MS, sleep, sendMessage, queryFacts, TestRunner,
} from "./e2e-helpers";

const t = new TestRunner("Danish / Multilingual E2E");
const db = new Database(DB_PATH);

console.log(`\n🔧 ${t.suiteName}`);
console.log(`   DB: ${DB_PATH}\n`);

// ── T1: Danish name — "Jeg hedder" ──────────────────────────────────────

console.log("── T1: Danish name via 'Jeg hedder' ──");
const resp1 = await sendMessage("Jeg hedder Søren", t.nextConv());
console.log(`   LLM: ${resp1.slice(0, 200)}`);
await sleep(WAIT_MS);

const sorenFacts = queryFacts(db, "slot = 'name' AND is_active = 1");
t.assert("T1: Name stored as Søren",
  sorenFacts.some((f) => f.slot_value?.includes("Søren")),
  sorenFacts.length > 0 ? `name=${sorenFacts[0]?.slot_value}` : "Missing");

// ── T2: Recall name in English (cross-language) ─────────────────────────

console.log("\n── T2: Recall name in English ──");
const resp2 = await sendMessage("What is my name?", t.nextConv());
console.log(`   LLM: ${resp2.slice(0, 200)}`);
await sleep(WAIT_MS);

const r2 = resp2.toLowerCase();
t.assert("T2: Recalls Søren in English",
  r2.includes("søren") || r2.includes("soren") || r2.includes("Søren"),
  r2.includes("søren") || r2.includes("soren") ? "Found" : `"${resp2.slice(0, 100)}"`);

// ── T3: Danish name correction — "Mit navn er" ─────────────────────────

console.log("\n── T3: Danish name correction via 'Mit navn er' ──");
const resp3 = await sendMessage("Mit navn er Anders", t.nextConv());
console.log(`   LLM: ${resp3.slice(0, 200)}`);
await sleep(WAIT_MS);

const sorenAfter = queryFacts(db, "slot = 'name' AND slot_value LIKE '%Søren%'");
const andersFacts = queryFacts(db, "slot = 'name' AND slot_value = 'Anders' AND is_active = 1");
t.assert("T3a: Søren deactivated", sorenAfter.every((f) => f.is_active === 0),
  sorenAfter.every((f) => f.is_active === 0) ? "Inactive" : "Still active!");
t.assert("T3b: Anders active", andersFacts.length >= 1,
  andersFacts.length >= 1 ? `(${andersFacts[0]?.source})` : "Missing");

// ── T4: Danish location — "Jeg bor i" ──────────────────────────────────

console.log("\n── T4: Danish location via 'Jeg bor i' ──");
const resp4 = await sendMessage("Jeg bor i København", t.nextConv());
console.log(`   LLM: ${resp4.slice(0, 200)}`);
await sleep(WAIT_MS);

const kbhFacts = queryFacts(db, "slot = 'location' AND is_active = 1");
t.assert("T4: Location stored as København",
  kbhFacts.some((f) => f.slot_value?.includes("København")),
  kbhFacts.length > 0 ? `location=${kbhFacts[0]?.slot_value}` : "Missing");

// ── T5: Danish location correction — "Jeg er flyttet til" ──────────────

console.log("\n── T5: Danish 'Jeg er flyttet til Aarhus' ──");
const resp5 = await sendMessage("Jeg er flyttet til Aarhus", t.nextConv());
console.log(`   LLM: ${resp5.slice(0, 200)}`);
await sleep(WAIT_MS);

const kbhAfter = queryFacts(db, "slot = 'location' AND slot_value LIKE '%København%'");
const aarhusFacts = queryFacts(db, "slot = 'location' AND slot_value LIKE '%Aarhus%' AND is_active = 1");
t.assert("T5a: København deactivated", kbhAfter.every((f) => f.is_active === 0),
  kbhAfter.every((f) => f.is_active === 0) ? "Inactive" : "Still active!");
t.assert("T5b: Aarhus active", aarhusFacts.length >= 1,
  aarhusFacts.length >= 1 ? `(${aarhusFacts[0]?.source})` : "Missing");

// ── T6: Language switch — English overrides Danish ──────────────────────

console.log("\n── T6: English overrides Danish name ──");
const resp6 = await sendMessage("Actually, call me Magnus", t.nextConv());
console.log(`   LLM: ${resp6.slice(0, 200)}`);
await sleep(WAIT_MS);

const andersAfter = queryFacts(db, "slot = 'name' AND slot_value = 'Anders'");
const magnusFacts = queryFacts(db, "slot = 'name' AND slot_value = 'Magnus' AND is_active = 1");
t.assert("T6a: Anders deactivated", andersAfter.every((f) => f.is_active === 0),
  andersAfter.every((f) => f.is_active === 0) ? "Inactive" : "Still active!");
t.assert("T6b: Magnus active", magnusFacts.length >= 1,
  magnusFacts.length >= 1 ? `(${magnusFacts[0]?.source})` : "Missing");

// ── T7: Danish age — "Jeg er X år" ─────────────────────────────────────

console.log("\n── T7: Danish age via 'Jeg er 32 år' ──");
const resp7 = await sendMessage("Jeg er 32 år", t.nextConv());
console.log(`   LLM: ${resp7.slice(0, 200)}`);
await sleep(WAIT_MS);

const ageFacts = queryFacts(db, "slot = 'age' AND is_active = 1");
t.assert("T7: Age stored as 32",
  ageFacts.some((f) => f.slot_value === "32"),
  ageFacts.length > 0 ? `age=${ageFacts[0]?.slot_value}` : "Missing");

// ── T8: Cross-slot isolation — age update doesn't touch name/location ──

console.log("\n── T8: Cross-slot isolation ──");
const resp8 = await sendMessage("I'm 35 years old", t.nextConv());
console.log(`   LLM: ${resp8.slice(0, 200)}`);
await sleep(WAIT_MS);

const nameStill = queryFacts(db, "slot = 'name' AND is_active = 1");
const locStill = queryFacts(db, "slot = 'location' AND is_active = 1");
const ageNew = queryFacts(db, "slot = 'age' AND is_active = 1");
t.assert("T8a: Name still Magnus", nameStill.some((f) => f.slot_value === "Magnus"),
  nameStill[0]?.slot_value === "Magnus" ? "OK" : `name=${nameStill[0]?.slot_value}`);
t.assert("T8b: Location still Aarhus", locStill.some((f) => f.slot_value?.includes("Aarhus")),
  locStill[0]?.slot_value?.includes("Aarhus") ? "OK" : `loc=${locStill[0]?.slot_value}`);
t.assert("T8c: Age updated to 35", ageNew.some((f) => f.slot_value === "35"),
  ageNew[0]?.slot_value === "35" ? "OK" : `age=${ageNew[0]?.slot_value}`);

// ── T9: Combined recall in Danish ───────────────────────────────────────

console.log("\n── T9: Recall in Danish ──");
const resp9 = await sendMessage("Hvad ved du om mig?", t.nextConv());
console.log(`   LLM: ${resp9.slice(0, 300)}`);
await sleep(WAIT_MS);

const r9 = resp9.toLowerCase();
t.assert("T9a: Mentions Magnus", r9.includes("magnus"), r9.includes("magnus") ? "Yes" : "Missing");
t.assert("T9b: Mentions Aarhus", r9.includes("aarhus"), r9.includes("aarhus") ? "Yes" : "Missing");
t.assert("T9c: No stale Søren", !r9.includes("søren") && !r9.includes("soren"),
  !r9.includes("søren") && !r9.includes("soren") ? "Clean" : "Leaked!");
t.assert("T9d: No stale København", !r9.includes("københavn") && !r9.includes("copenhagen"),
  !r9.includes("københavn") && !r9.includes("copenhagen") ? "Clean" : "Leaked!");

// ── Cleanup ─────────────────────────────────────────────────────────────

console.log("\n── Cleanup ──");
t.cleanup(db);
db.close();
console.log("   Done.");

process.exit(t.summary() ? 0 : 1);
