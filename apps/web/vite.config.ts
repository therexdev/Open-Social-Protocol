import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static SPA build. `base: "/"` and dist/ are what Hostinger (docs/hostinger.md) expects;
// public/.htaccess is copied verbatim so deep links resolve to index.html.
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
  server: {
    fs: {
      // deployments/*.json live at the repository root (import.meta.glob in src/config.ts)
      allow: ["../.."],
    },
  },
});
