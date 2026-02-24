import { describe, test, expect } from "bun:test";
import { parseGlobalOpts } from "../index";
import { parseSetupFlags } from "../commands/setup";
import { formatUptime } from "../commands/status";

describe("parseGlobalOpts", () => {
  test("defaults with no args", () => {
    const { opts, rest } = parseGlobalOpts([]);
    expect(opts.gateway).toBe(Bun.env.SPACEDUCK_GATEWAY_URL ?? "http://localhost:3000");
    expect(opts.token).toBe(Bun.env.SPACEDUCK_TOKEN ?? null);
    expect(opts.json).toBe(false);
    expect(rest).toEqual([]);
  });

  test("--gateway overrides default", () => {
    const { opts } = parseGlobalOpts(["--gateway", "http://example.com:9000"]);
    expect(opts.gateway).toBe("http://example.com:9000");
  });

  test("--token sets token", () => {
    const { opts } = parseGlobalOpts(["--token", "my-secret"]);
    expect(opts.token).toBe("my-secret");
  });

  test("--json enables json mode", () => {
    const { opts } = parseGlobalOpts(["--json"]);
    expect(opts.json).toBe(true);
  });

  test("non-flag args pass through in rest", () => {
    const { opts, rest } = parseGlobalOpts([
      "--gateway", "http://gw:3000",
      "status",
      "--json",
    ]);
    expect(opts.gateway).toBe("http://gw:3000");
    expect(opts.json).toBe(true);
    expect(rest).toEqual(["status"]);
  });

  test("multiple rest args preserved in order", () => {
    const { rest } = parseGlobalOpts(["config", "set", "/ai/model", "gpt-4"]);
    expect(rest).toEqual(["config", "set", "/ai/model", "gpt-4"]);
  });

  test("--gateway without value is treated as rest arg", () => {
    const { rest } = parseGlobalOpts(["--gateway"]);
    expect(rest).toEqual(["--gateway"]);
  });

  test("--token without value is treated as rest arg", () => {
    const { rest } = parseGlobalOpts(["--token"]);
    expect(rest).toEqual(["--token"]);
  });
});

describe("parseSetupFlags", () => {
  test("empty args returns no flags", () => {
    const flags = parseSetupFlags([]);
    expect(flags.mode).toBeUndefined();
    expect(flags.skip).toBeUndefined();
  });

  test("--mode local", () => {
    expect(parseSetupFlags(["--mode", "local"]).mode).toBe("local");
  });

  test("--mode cloud", () => {
    expect(parseSetupFlags(["--mode", "cloud"]).mode).toBe("cloud");
  });

  test("--mode advanced", () => {
    expect(parseSetupFlags(["--mode", "advanced"]).mode).toBe("advanced");
  });

  test("--skip sets skip flag", () => {
    expect(parseSetupFlags(["--skip"]).skip).toBe(true);
  });

  test("--mode without value is ignored", () => {
    const flags = parseSetupFlags(["--mode"]);
    expect(flags.mode).toBeUndefined();
  });
});

describe("formatUptime", () => {
  test("seconds < 60", () => {
    expect(formatUptime(0)).toBe("0s");
    expect(formatUptime(1)).toBe("1s");
    expect(formatUptime(59)).toBe("59s");
    expect(formatUptime(59.9)).toBe("59s");
  });

  test("minutes < 3600", () => {
    expect(formatUptime(60)).toBe("1m");
    expect(formatUptime(119)).toBe("1m");
    expect(formatUptime(120)).toBe("2m");
    expect(formatUptime(3599)).toBe("59m");
  });

  test("hours with minutes", () => {
    expect(formatUptime(3600)).toBe("1h 0m");
    expect(formatUptime(3660)).toBe("1h 1m");
    expect(formatUptime(7200)).toBe("2h 0m");
    expect(formatUptime(7320)).toBe("2h 2m");
    expect(formatUptime(86400)).toBe("24h 0m");
  });
});
