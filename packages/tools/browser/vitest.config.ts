import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/browser.test.ts"],
    testTimeout: 30_000,
  },
});
