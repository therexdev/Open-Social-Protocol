import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.ts";

// Builds the manifest, the service worker, the side panel and the options page.
// Content scripts are built separately as self-contained classic scripts (scripts/build-content.mjs)
// because they are registered at runtime and must not use ES module imports.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
  server: {
    port: 5174,
    strictPort: true,
    hmr: { port: 5174 },
    fs: {
      // deployments/*.json live at the repository root (import.meta.glob in src/shared/config.ts)
      allow: ["../.."],
    },
  },
});
