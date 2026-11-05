import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Reuse the actual web client, not a fork. Hash routes and relative assets work
// in Chrome extension pages; the website's PWA worker is deliberately excluded.
export default defineConfig({
  root: fileURLToPath(new URL("./src/social/", import.meta.url)),
  plugins: [react()], publicDir: false, base: "./",
  build: { outDir: fileURLToPath(new URL("./dist/social/", import.meta.url)), emptyOutDir: true, target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1800 },
});
