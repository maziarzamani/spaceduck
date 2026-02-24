import { describe, test, expect } from "bun:test";
import { classifyError, buildErrorHint } from "../errors";

describe("classifyError", () => {
  test("returns 'cancelled' for AbortError", () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    expect(classifyError(err)).toBe("cancelled");
  });

  test("returns 'cancelled' for aborted message", () => {
    expect(classifyError(new Error("Request was aborted by client"))).toBe("cancelled");
  });

  test("returns 'cancelled' for cancelled message", () => {
    expect(classifyError(new Error("Request cancelled"))).toBe("cancelled");
  });

  test("returns 'transient_network' for ECONNREFUSED", () => {
    expect(classifyError(new Error("connect ECONNREFUSED 127.0.0.1:8080"))).toBe("transient_network");
  });

  test("returns 'transient_network' for ECONNRESET", () => {
    expect(classifyError(new Error("read ECONNRESET"))).toBe("transient_network");
  });

  test("returns 'transient_network' for ENOTFOUND", () => {
    expect(classifyError(new Error("getaddrinfo ENOTFOUND api.example.com"))).toBe("transient_network");
  });

  test("returns 'transient_network' for ETIMEDOUT", () => {
    expect(classifyError(new Error("connect ETIMEDOUT"))).toBe("transient_network");
  });

  test("returns 'transient_network' for network keyword", () => {
    expect(classifyError(new Error("Network request failed"))).toBe("transient_network");
  });

  test("returns 'transient_network' for fetch failed", () => {
    expect(classifyError(new Error("fetch failed"))).toBe("transient_network");
  });

  test("returns 'auth_failed' for api key errors", () => {
    expect(classifyError(new Error("Invalid API key provided"))).toBe("auth_failed");
  });

  test("returns 'auth_failed' for unauthorized", () => {
    expect(classifyError(new Error("Unauthorized access"))).toBe("auth_failed");
  });

  test("returns 'auth_failed' for forbidden", () => {
    expect(classifyError(new Error("Forbidden"))).toBe("auth_failed");
  });

  test("returns 'auth_failed' for 401 status", () => {
    expect(classifyError(new Error("HTTP 401 error"))).toBe("auth_failed");
  });

  test("returns 'auth_failed' for 403 status", () => {
    expect(classifyError(new Error("HTTP 403 error"))).toBe("auth_failed");
  });

  test("returns 'throttled' for rate limit", () => {
    expect(classifyError(new Error("Rate limit exceeded"))).toBe("throttled");
  });

  test("returns 'throttled' for 429", () => {
    expect(classifyError(new Error("HTTP 429 Too Many Requests"))).toBe("throttled");
  });

  test("returns 'throttled' for quota", () => {
    expect(classifyError(new Error("Quota exceeded"))).toBe("throttled");
  });

  test("returns 'context_length_exceeded' for context length", () => {
    expect(classifyError(new Error("Maximum context length exceeded"))).toBe("context_length_exceeded");
  });

  test("returns 'context_length_exceeded' for too long", () => {
    expect(classifyError(new Error("Input is too long"))).toBe("context_length_exceeded");
  });

  test("returns 'invalid_request' for invalid", () => {
    expect(classifyError(new Error("Invalid parameter in request"))).toBe("invalid_request");
  });

  test("returns 'invalid_request' for 400", () => {
    expect(classifyError(new Error("HTTP 400"))).toBe("invalid_request");
  });

  test("returns 'invalid_request' for bad request", () => {
    expect(classifyError(new Error("Bad request"))).toBe("invalid_request");
  });

  test("returns 'unknown' for non-Error values", () => {
    expect(classifyError("just a string")).toBe("unknown");
    expect(classifyError(42)).toBe("unknown");
    expect(classifyError(null)).toBe("unknown");
    expect(classifyError(undefined)).toBe("unknown");
  });

  test("returns 'unknown' for unrecognized Error messages", () => {
    expect(classifyError(new Error("Something completely different happened"))).toBe("unknown");
  });
});

describe("buildErrorHint", () => {
  test("returns server hint for transient_network", () => {
    const hint = buildErrorHint("transient_network", "llamacpp", "http://127.0.0.1:8080");
    expect(hint).toContain("llamacpp");
    expect(hint).toContain("http://127.0.0.1:8080");
    expect(hint).toContain("running");
  });

  test("returns empty string for non-network errors", () => {
    expect(buildErrorHint("auth_failed", "test", "http://localhost")).toBe("");
    expect(buildErrorHint("throttled", "test", "http://localhost")).toBe("");
    expect(buildErrorHint("unknown", "test", "http://localhost")).toBe("");
    expect(buildErrorHint("cancelled", "test", "http://localhost")).toBe("");
  });
});
