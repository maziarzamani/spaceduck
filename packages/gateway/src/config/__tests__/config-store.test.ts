import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { ConfigStore } from "../config-store";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";

function tempDir(): string {
  return join(tmpdir(), `spaceduck-config-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

describe("ConfigStore", () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(() => {
    dir = tempDir();
    store = new ConfigStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("first boot creates config file with defaults", async () => {
    const config = await store.load();
    expect(config.version).toBe(1);
    expect(config.ai.provider).toBe("gemini");

    const file = Bun.file(join(dir, "spaceduck.config.json5"));
    expect(await file.exists()).toBe(true);
  });

  test("load reads existing config file", async () => {
    const customConfig = {
      version: 1,
      ai: { provider: "bedrock", model: "claude-4" },
    };
    await Bun.write(
      join(dir, "spaceduck.config.json5"),
      JSON.stringify(customConfig),
    );
    const config = await store.load();
    expect(config.ai.provider).toBe("bedrock");
    expect(config.ai.model).toBe("claude-4");
    // Defaults filled in by Zod
    expect(config.ai.temperature).toBe(0.7);
  });

  test("rev is stable for same config", async () => {
    await store.load();
    const rev1 = store.rev();
    const rev2 = store.rev();
    expect(rev1).toBe(rev2);
    expect(rev1).toHaveLength(64); // SHA-256 hex
  });

  test("rev changes after patch", async () => {
    await store.load();
    const revBefore = store.rev();
    const result = await store.patch(
      [{ op: "replace", path: "/ai/model", value: "gemini-2.5-pro" }],
      revBefore,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rev).not.toBe(revBefore);
    }
  });

  test("secret change does NOT change rev", async () => {
    await store.load();
    const revBefore = store.rev();
    await store.setSecret("/ai/secrets/geminiApiKey", "AIza-test");
    const revAfter = store.rev();
    expect(revAfter).toBe(revBefore);
  });

  test("patch rejects mismatched rev (409)", async () => {
    await store.load();
    const result = await store.patch(
      [{ op: "replace", path: "/ai/model", value: "x" }],
      "wrong-rev",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("CONFLICT");
    }
  });

  test("patch rejects secret paths", async () => {
    await store.load();
    const rev = store.rev();
    const result = await store.patch(
      [{ op: "replace", path: "/ai/secrets/geminiApiKey", value: "leaked" }],
      rev,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("PATCH_ERROR");
    }
  });

  test("patch returns needsRestart for non-hot-apply paths", async () => {
    await store.load();
    const rev = store.rev();
    const result = await store.patch(
      [{ op: "replace", path: "/ai/provider", value: "bedrock" }],
      rev,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.needsRestart?.fields).toContain("/ai/provider");
    }
  });

  test("patch returns no needsRestart for hot-apply paths", async () => {
    await store.load();
    const rev = store.rev();
    const result = await store.patch(
      [{ op: "replace", path: "/ai/temperature", value: 1.2 }],
      rev,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.needsRestart).toBeUndefined();
    }
  });

  test("getRedacted returns redacted config + rev + secrets", async () => {
    await store.load();
    await store.setSecret("/ai/secrets/geminiApiKey", "real-key");

    const { config, rev, secrets } = store.getRedacted();
    expect(config.ai.secrets.geminiApiKey).toBeNull(); // redacted
    expect(rev).toHaveLength(64);
    const gemini = secrets.find((s) => s.path === "/ai/secrets/geminiApiKey");
    expect(gemini?.isSet).toBe(true);
  });

  test("setSecret / unsetSecret", async () => {
    await store.load();
    await store.setSecret("/ai/secrets/bedrockApiKey", "bedrock-123");
    expect(store.current.ai.secrets.bedrockApiKey).toBe("bedrock-123");

    await store.unsetSecret("/ai/secrets/bedrockApiKey");
    expect(store.current.ai.secrets.bedrockApiKey).toBeNull();
  });

  test("setSecret rejects non-secret path", async () => {
    await store.load();
    expect(() =>
      store.setSecret("/ai/model", "x"),
    ).toThrow(/not a known secret path/);
  });

  test("config persists across reload", async () => {
    await store.load();
    const rev = store.rev();
    await store.patch(
      [{ op: "replace", path: "/gateway/name", value: "my-duck" }],
      rev,
    );

    // Create new store pointing to same dir
    const store2 = new ConfigStore(dir);
    await store2.load();
    expect(store2.current.gateway.name).toBe("my-duck");
  });
});
