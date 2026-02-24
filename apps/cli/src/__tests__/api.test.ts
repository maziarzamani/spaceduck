import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test";
import { CliError, parseGlobalOpts, type GlobalOpts } from "../index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Import apiFetch after test setup
const { apiFetch } = await import("../lib/api");

function mockFetchResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
    ),
  ) as any;
}

const defaultOpts: GlobalOpts = {
  gateway: "http://localhost:3000",
  token: null,
  json: false,
};

describe("apiFetch", () => {
  test("fetches data and returns parsed JSON with headers", async () => {
    mockFetchResponse({ status: "ok" });

    const result = await apiFetch<{ status: string }>(defaultOpts, "/api/health");

    expect(result.data).toEqual({ status: "ok" });
    expect(result.headers).toBeDefined();
  });

  test("sends Authorization header when token is set", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }) as any;

    await apiFetch({ ...defaultOpts, token: "my-token" }, "/api/test");

    expect(capturedHeaders["authorization"]).toBe("Bearer my-token");
  });

  test("does not send Authorization header when no token", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }) as any;

    await apiFetch(defaultOpts, "/api/test");

    expect(capturedHeaders["authorization"]).toBeUndefined();
  });

  test("sets content-type when body is present", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }) as any;

    await apiFetch(defaultOpts, "/api/test", {
      method: "PATCH",
      body: JSON.stringify({ value: 1 }),
    });

    expect(capturedHeaders["content-type"]).toBe("application/json");
  });

  test("throws CliError on 401 Unauthorized", async () => {
    mockFetchResponse({}, 401);

    try {
      await apiFetch(defaultOpts, "/api/test");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("Unauthorized");
    }
  });

  test("throws CliError on 409 Conflict", async () => {
    mockFetchResponse({}, 409);

    try {
      await apiFetch(defaultOpts, "/api/test");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("Conflict");
    }
  });

  test("throws CliError with error body on other HTTP errors", async () => {
    mockFetchResponse({ error: "Something failed" }, 500);

    try {
      await apiFetch(defaultOpts, "/api/test");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("Something failed");
    }
  });

  test("throws CliError when gateway is unreachable", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED"))) as any;

    try {
      await apiFetch(defaultOpts, "/api/test");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("Cannot reach gateway");
    }
  });

  test("constructs URL from gateway + path", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }) as any;

    await apiFetch(
      { ...defaultOpts, gateway: "http://myhost:4000" },
      "/api/config",
    );

    expect(capturedUrl).toBe("http://myhost:4000/api/config");
  });
});

describe("parseGlobalOpts", () => {
  test("parses --gateway flag", () => {
    const { opts } = parseGlobalOpts(["--gateway", "http://custom:5000", "status"]);
    expect(opts.gateway).toBe("http://custom:5000");
  });

  test("parses --token flag", () => {
    const { opts } = parseGlobalOpts(["--token", "tok123", "status"]);
    expect(opts.token).toBe("tok123");
  });

  test("parses --json flag", () => {
    const { opts } = parseGlobalOpts(["--json", "config", "get"]);
    expect(opts.json).toBe(true);
  });

  test("returns rest args without global flags", () => {
    const { rest } = parseGlobalOpts(["--json", "config", "get", "/ai/model"]);
    expect(rest).toEqual(["config", "get", "/ai/model"]);
  });

  test("defaults gateway to localhost:3000", () => {
    const { opts } = parseGlobalOpts(["status"]);
    expect(opts.gateway).toContain("3000");
  });
});
