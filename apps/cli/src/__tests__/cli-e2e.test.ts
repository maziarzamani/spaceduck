import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createGateway, Gateway } from "../../../../packages/gateway/src/gateway";
import type { Message, Provider, ProviderOptions, ProviderChunk } from "@spaceduck/core";

process.env.SPACEDUCK_REQUIRE_AUTH = "0";

class TestProvider implements Provider {
  readonly name = "cli-test";
  async *chat(messages: Message[], options?: ProviderOptions): AsyncIterable<ProviderChunk> {
    yield { type: "text", text: "Test response" };
  }
}

const PORT = 49152 + Math.floor(Math.random() * 10000);
const GATEWAY = `http://localhost:${PORT}`;
const CLI = ["bun", "run", "apps/cli/src/index.ts"];

let gateway: Gateway;

function run(...args: string[]) {
  return Bun.spawn([...CLI, "--gateway", GATEWAY, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: import.meta.dir + "/../../../..",
  });
}

async function exec(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = run(...args);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

describe("CLI e2e", () => {
  beforeAll(async () => {
    gateway = await createGateway({
      provider: new TestProvider(),
      config: {
        port: PORT,
        logLevel: "error",
        provider: { name: "cli-test", model: "test-model" },
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

  // ── Help ──────────────────────────────────────────────────────────

  test("--help prints usage and exits 0", async () => {
    const { stdout, exitCode } = await exec("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("spaceduck");
    expect(stdout).toContain("config get");
    expect(stdout).toContain("config set");
    expect(stdout).toContain("config paths");
  });

  test("no args prints usage and exits 0", async () => {
    const proc = Bun.spawn([...CLI], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: import.meta.dir + "/../../../..",
    });
    const [stdout, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
  });

  // ── Status ────────────────────────────────────────────────────────

  test("status shows connected gateway", async () => {
    const { stdout, exitCode } = await exec("status");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Gateway");
    expect(stdout).toContain("connected");
  });

  test("status --json returns valid JSON", async () => {
    const { stdout, exitCode } = await exec("status", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.gateway).toBe("connected");
    expect(data.provider).toBeDefined();
    expect(typeof data.uptime).toBe("number");
  });

  test("status with bad gateway fails", async () => {
    const proc = Bun.spawn(
      [...CLI, "--gateway", "http://localhost:19999", "status"],
      { stdout: "pipe", stderr: "pipe", cwd: import.meta.dir + "/../../../.." },
    );
    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
  });

  // ── Config get ────────────────────────────────────────────────────

  test("config get (no path) returns full config JSON", async () => {
    const { stdout, exitCode } = await exec("config", "get");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.split("\nrev:")[0]);
    expect(parsed.ai).toBeDefined();
    expect(parsed.ai.provider).toBeDefined();
    expect(parsed.tools).toBeDefined();
  });

  test("config get /ai/provider returns a string", async () => {
    const { stdout, exitCode } = await exec("config", "get", "/ai/provider");
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  test("config get /ai/temperature returns a number", async () => {
    const { stdout, exitCode } = await exec("config", "get", "/ai/temperature");
    expect(exitCode).toBe(0);
    expect(Number(stdout)).toBeGreaterThan(0);
    expect(Number(stdout)).toBeLessThanOrEqual(2);
  });

  test("config get /ai returns nested object", async () => {
    const { stdout, exitCode } = await exec("config", "get", "/ai");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.provider).toBeDefined();
    expect(typeof parsed.temperature).toBe("number");
  });

  test("config get nonexistent path fails", async () => {
    const { stderr, exitCode } = await exec("config", "get", "/does/not/exist");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("does not exist");
  });

  test("config get without leading slash fails", async () => {
    const { stderr, exitCode } = await exec("config", "get", "ai/provider");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("must start with /");
  });

  // ── Config paths ──────────────────────────────────────────────────

  test("config paths lists all paths", async () => {
    const { stdout, exitCode } = await exec("config", "paths");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("/ai/provider");
    expect(stdout).toContain("/ai/model");
    expect(stdout).toContain("/ai/temperature");
    expect(stdout).toContain("/tools/webSearch/provider");
    expect(stdout).toContain("(secret)");
  });

  test("config paths --json returns flat object", async () => {
    const { stdout, exitCode } = await exec("config", "paths", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data["/ai/provider"]).toBeDefined();
    expect(data["/ai/temperature"]).toBeDefined();
  });

  // ── Config set ────────────────────────────────────────────────────

  let originalTemp: number;

  test("config set changes a value", async () => {
    const { stdout: orig } = await exec("config", "get", "/ai/temperature");
    originalTemp = Number(orig);

    const newTemp = originalTemp === 0.7 ? 0.9 : 0.7;
    const { stdout, exitCode } = await exec("config", "set", "/ai/temperature", String(newTemp));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Set /ai/temperature");

    const { stdout: after } = await exec("config", "get", "/ai/temperature");
    expect(Number(after)).toBe(newTemp);
  });

  test("config set restores original value", async () => {
    const { exitCode } = await exec("config", "set", "/ai/temperature", String(originalTemp));
    expect(exitCode).toBe(0);
    const { stdout } = await exec("config", "get", "/ai/temperature");
    expect(Number(stdout)).toBe(originalTemp);
  });

  test("config set with boolean value", async () => {
    const { exitCode } = await exec("config", "set", "/stt/enabled", "true");
    expect(exitCode).toBe(0);
    const { stdout: after } = await exec("config", "get", "/stt/enabled");
    expect(after).toBe("true");
  });

  test("config set missing args shows usage", async () => {
    const { stderr, exitCode } = await exec("config", "set");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  test("config set without leading slash fails", async () => {
    const { stderr, exitCode } = await exec("config", "set", "ai/temperature", "0.5");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("must start with /");
  });

  // ── Config secret ─────────────────────────────────────────────────

  test("config secret with no args shows usage", async () => {
    const { stderr, exitCode } = await exec("config", "secret");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  test("config secret set with no path shows usage", async () => {
    const { stderr, exitCode } = await exec("config", "secret", "set");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  // ── Unknown commands ──────────────────────────────────────────────

  test("unknown command exits 1", async () => {
    const { stderr, exitCode } = await exec("foobar");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command");
  });

  test("unknown config subcommand exits 1", async () => {
    const { stderr, exitCode } = await exec("config", "foobar");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown config subcommand");
  });
});
