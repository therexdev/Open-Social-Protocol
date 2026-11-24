import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Full-size media crypto and multi-browser messaging fixtures exceed 5s on constrained runners.
    testTimeout: 60000,
    maxWorkers: 2,
    setupFiles: ["src/test/nodeRealm.ts", "src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
