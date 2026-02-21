import { describe, test, expect } from "bun:test";
import { OpenAICompatibleProvider } from "../provider";

// Test normalizeBaseUrl via the public constructor
function makeProvider(baseUrl: string) {
  return new OpenAICompatibleProvider({ name: "test", baseUrl, model: null });
}

describe("OpenAICompatibleProvider baseUrl normalization", () => {
  test("appends /v1 when missing", () => {
    const p = makeProvider("http://127.0.0.1:8080");
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  test("keeps /v1 when already present", () => {
    const p = makeProvider("http://127.0.0.1:8080/v1");
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  test("strips trailing slash then keeps /v1", () => {
    const p = makeProvider("http://127.0.0.1:8080/v1/");
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  test("strips full chat/completions endpoint", () => {
    const p = makeProvider("http://127.0.0.1:8080/v1/chat/completions");
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  test("handles multiple trailing slashes", () => {
    const p = makeProvider("http://127.0.0.1:8080/v1///");
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });
});

describe("OpenAICompatibleProvider model handling", () => {
  test("null model is stored as null", () => {
    const p = makeProvider("http://localhost/v1");
    expect((p as any).model).toBeNull();
  });

  test("string model is stored as-is", () => {
    const p = new OpenAICompatibleProvider({ name: "test", baseUrl: "http://localhost/v1", model: "gpt-4" });
    expect((p as any).model).toBe("gpt-4");
  });

  test("undefined model defaults to null", () => {
    const p = new OpenAICompatibleProvider({ name: "test", baseUrl: "http://localhost/v1" });
    expect((p as any).model).toBeNull();
  });
});
