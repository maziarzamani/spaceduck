import { describe, it, expect } from "bun:test";
import { LMStudioEmbeddingProvider } from "../embedding";

describe("LMStudioEmbeddingProvider", () => {
  it("defaults name to 'lmstudio'", () => {
    const provider = new LMStudioEmbeddingProvider({
      model: "nomic-embed-text-v1.5",
      dimensions: 768,
    });
    expect(provider.name).toBe("lmstudio");
  });

  it("accepts a name override for llamacpp reuse", () => {
    const provider = new LMStudioEmbeddingProvider({
      name: "llamacpp",
      model: "nomic-embed-text-v1.5",
      dimensions: 768,
    });
    expect(provider.name).toBe("llamacpp");
  });

  it("exposes model as a public readonly property", () => {
    const provider = new LMStudioEmbeddingProvider({
      model: "nomic-embed-text-v1.5",
      dimensions: 768,
    });
    expect(provider.model).toBe("nomic-embed-text-v1.5");
  });

  it("defaults dimensions to 1024", () => {
    const provider = new LMStudioEmbeddingProvider({
      model: "some-model",
    });
    expect(provider.dimensions).toBe(1024);
  });

  it("uses provided dimensions", () => {
    const provider = new LMStudioEmbeddingProvider({
      model: "some-model",
      dimensions: 768,
    });
    expect(provider.dimensions).toBe(768);
  });
});
