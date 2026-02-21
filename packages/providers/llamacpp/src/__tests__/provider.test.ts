import { describe, test, expect } from "bun:test";
import { LlamaCppProvider } from "../provider";

describe("LlamaCppProvider", () => {
  test("defaults: model is null, baseUrl normalizes to /v1", () => {
    const p = new LlamaCppProvider();
    // Access internals via the protected fields
    expect((p as any).model).toBeNull();
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  test("normalizes baseUrl without /v1", () => {
    const p = new LlamaCppProvider({ baseUrl: "http://127.0.0.1:8080" });
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  test("normalizes baseUrl with trailing slash", () => {
    const p = new LlamaCppProvider({ baseUrl: "http://127.0.0.1:8080/v1/" });
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  test("normalizes full endpoint URL", () => {
    const p = new LlamaCppProvider({ baseUrl: "http://127.0.0.1:8080/v1/chat/completions" });
    expect((p as any).baseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  test("model is passed through when set", () => {
    const p = new LlamaCppProvider({ model: "my-model" });
    expect((p as any).model).toBe("my-model");
  });

  test("provider name is llamacpp", () => {
    const p = new LlamaCppProvider();
    expect(p.name).toBe("llamacpp");
  });
});
