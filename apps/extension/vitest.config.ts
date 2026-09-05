import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/nodeRealm.ts", "src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    testTimeout: 30_000,
  },
});
