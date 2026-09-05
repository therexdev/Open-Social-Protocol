// Builds each content script as a self-contained classic script (IIFE, no imports) into
// dist/content/<name>.js. They are registered at runtime with chrome.scripting.registerContentScripts
// and run in the isolated world, so they must not depend on module loading or on any chunk.
import { build } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

// apps/extension (this file lives in apps/extension/scripts)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entries = {
  facebook: "src/content/facebook.ts",
};

for (const [name, entry] of Object.entries(entries)) {
  await build({
    root,
    configFile: false,
    publicDir: false, // icons are emitted by the main build (manifest references)
    logLevel: "warn",
    build: {
      outDir: "dist",
      emptyOutDir: false,
      sourcemap: false,
      target: "es2022",
      minify: false,
      lib: {
        entry: path.resolve(root, entry),
        formats: ["iife"],
        name: `ospContent_${name}`,
        fileName: () => `content/${name}.js`,
      },
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  });
  console.log(`built dist/content/${name}.js`);
}
