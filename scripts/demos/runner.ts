#!/usr/bin/env bun
/**
 * Demo runner — boots gateway + Vite, drives UI with Playwright, records GIFs.
 *
 * Usage:
 *   bun run scripts/demos/runner.ts                     # all scenarios, generate GIFs
 *   bun run scripts/demos/runner.ts --test-only         # smoke test only, no GIFs
 *   bun run scripts/demos/runner.ts --scenario chat-flow # single scenario
 */

import { chromium, type Browser, type BrowserContext } from "playwright";
import { spawn, type Subprocess } from "bun";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DemoScenario } from "./types";

const GATEWAY_PORT = 3099;
const VITE_PORT = 1499;
const GATEWAY_URL = `http://localhost:${GATEWAY_PORT}`;
const UI_URL = `http://localhost:${VITE_PORT}`;
const ROOT = join(import.meta.dir, "../..");
const ASSETS_DIR = join(ROOT, "assets");

const args = process.argv.slice(2);
const testOnly = args.includes("--test-only");
const scenarioFilter = args.includes("--scenario")
  ? args[args.indexOf("--scenario") + 1]
  : null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`  [demo] ${msg}`);
}

async function waitForReady(url: string, label: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        log(`${label} ready`);
        return;
      }
    } catch {}
    await Bun.sleep(500);
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
}

async function convertToGif(webmPath: string, gifPath: string): Promise<void> {
  const proc = spawn({
    cmd: [
      "ffmpeg", "-y", "-i", webmPath,
      "-vf", "fps=12,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
      gifPath,
    ],
    stdout: "ignore",
    stderr: "ignore",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
}

// ── Load scenarios ───────────────────────────────────────────────────────────

async function loadScenarios(): Promise<DemoScenario[]> {
  const scenarioDir = join(import.meta.dir, "scenarios");
  const files = await readdir(scenarioDir);
  const scenarios: DemoScenario[] = [];
  for (const file of files.filter((f) => f.endsWith(".ts"))) {
    const mod = await import(join(scenarioDir, file));
    if (mod.default) scenarios.push(mod.default);
    else if (mod.scenario) scenarios.push(mod.scenario);
  }
  if (scenarioFilter) {
    const filtered = scenarios.filter((s) => s.name === scenarioFilter);
    if (filtered.length === 0) {
      throw new Error(`No scenario named "${scenarioFilter}". Available: ${scenarios.map((s) => s.name).join(", ")}`);
    }
    return filtered;
  }
  return scenarios;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const scenarios = await loadScenarios();
  log(`Loaded ${scenarios.length} scenario(s): ${scenarios.map((s) => s.name).join(", ")}`);

  const tmpDir = await mkdtemp(join(tmpdir(), "spaceduck-demos-"));
  const procs: Subprocess[] = [];

  try {
    // 1. Spawn gateway
    log("Starting gateway...");
    const gateway = spawn({
      cmd: ["bun", "run", "packages/gateway/src/index.ts"],
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(GATEWAY_PORT),
        SPACEDUCK_REQUIRE_AUTH: "0",
      },
      stdout: "ignore",
      stderr: "ignore",
    });
    procs.push(gateway);

    // 2. Spawn Vite
    log("Starting Vite...");
    const vite = spawn({
      cmd: ["bunx", "vite", "--port", String(VITE_PORT)],
      cwd: join(ROOT, "apps/web"),
      env: process.env,
      stdout: "ignore",
      stderr: "ignore",
    });
    procs.push(vite);

    // 3. Wait for both
    await Promise.all([
      waitForReady(`${GATEWAY_URL}/api/health`, "Gateway"),
      waitForReady(UI_URL, "Vite"),
    ]);

    // 4. Launch Playwright
    log("Launching browser...");
    const browser = await chromium.launch({ headless: true });

    const results: { name: string; videoPath?: string; passed: boolean; error?: string }[] = [];

    // 5. Run scenarios
    for (const scenario of scenarios) {
      const viewport = scenario.viewport ?? { width: 1280, height: 720 };
      const videoDir = join(tmpDir, scenario.name);
      await Bun.write(join(videoDir, ".keep"), "");

      const context = await browser.newContext({
        viewport,
        recordVideo: { dir: videoDir, size: viewport },
        colorScheme: "dark",
      });

      const page = await context.newPage();

      // Seed localStorage before any navigation
      await page.addInitScript((gatewayUrl: string) => {
        localStorage.setItem("spaceduck.gatewayUrl", gatewayUrl);
        localStorage.setItem("spaceduck.onboardingCompleted", "1");
        localStorage.setItem("spaceduck.theme", "dark");
      }, GATEWAY_URL);

      log(`Running: ${scenario.name} — ${scenario.description}`);

      try {
        await scenario.run(page, UI_URL);
        log(`  PASS: ${scenario.name}`);
        results.push({ name: scenario.name, passed: true });
      } catch (err: any) {
        log(`  FAIL: ${scenario.name} — ${err.message}`);
        results.push({ name: scenario.name, passed: false, error: err.message });
      }

      // Close context to flush video
      const videoObj = page.video();
      await context.close();

      if (videoObj) {
        const vPath = await videoObj.path();
        const match = results.find((r) => r.name === scenario.name);
        if (match) match.videoPath = vPath;
      }
    }

    await browser.close();

    // 6. Convert to GIFs
    if (!testOnly) {
      log("Converting videos to GIFs...");
      for (const r of results) {
        if (!r.videoPath) continue;
        const gifPath = join(ASSETS_DIR, `demo-${r.name}.gif`);
        try {
          await convertToGif(r.videoPath, gifPath);
          log(`  Generated: ${gifPath}`);
        } catch (err: any) {
          log(`  GIF conversion failed for ${r.name}: ${err.message}`);
        }
      }
    }

    // 7. Summary
    console.log("\n  ── Results ──");
    const passCount = results.filter((r) => r.passed).length;
    const failCount = results.filter((r) => !r.passed).length;
    for (const r of results) {
      console.log(`  ${r.passed ? "PASS" : "FAIL"}  ${r.name}${r.error ? ` — ${r.error}` : ""}`);
    }
    console.log(`\n  ${passCount} passed, ${failCount} failed\n`);

    if (failCount > 0) process.exit(1);

  } finally {
    // 8. Kill servers
    for (const p of procs) {
      try { p.kill(); } catch {}
    }
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("Demo runner failed:", err);
  process.exit(1);
});
