import { describe, it, expect, mock, afterEach } from "bun:test";
import { API_VERSION } from "@spaceduck/core";
import { CliError, type GlobalOpts } from "../index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const defaultOpts: GlobalOpts = {
  gateway: "http://localhost:3000",
  token: null,
  json: false,
};

function mockHealthResponse(body: Record<string, unknown>, status = 200) {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  ) as any;
}

describe("ensureCompatible", () => {
  it("passes when apiVersion matches", async () => {
    mockHealthResponse({ status: "ok", apiVersion: API_VERSION });
    const { ensureCompatible } = await import("../lib/compat");

    await expect(ensureCompatible(defaultOpts)).resolves.toBeUndefined();
  });

  it("throws CliError when gateway apiVersion is higher", async () => {
    mockHealthResponse({ status: "ok", apiVersion: API_VERSION + 1 });
    const { ensureCompatible } = await import("../lib/compat");

    try {
      await ensureCompatible(defaultOpts);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("mismatch");
      expect((err as CliError).message).toContain("upgrade your CLI");
    }
  });

  it("throws CliError when gateway apiVersion is lower", async () => {
    mockHealthResponse({ status: "ok", apiVersion: 0 });
    const { ensureCompatible } = await import("../lib/compat");

    try {
      await ensureCompatible(defaultOpts);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("mismatch");
      expect((err as CliError).message).toContain("upgrade your gateway");
    }
  });

  it("passes silently when gateway is unreachable", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED"))) as any;
    const { ensureCompatible } = await import("../lib/compat");

    await expect(ensureCompatible(defaultOpts)).resolves.toBeUndefined();
  });

  it("passes when gateway does not return apiVersion", async () => {
    mockHealthResponse({ status: "ok" });
    const { ensureCompatible } = await import("../lib/compat");

    await expect(ensureCompatible(defaultOpts)).resolves.toBeUndefined();
  });
});
