import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
export function pwaBuild(): Plugin {
  let root = "";
  let out = "";
  return {
    name: "osp-pwa", apply: "build",
    configResolved(config) { root = config.root; out = resolve(root, config.build.outDir); },
    closeBundle() {
      const files = ["/index.html", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png", ...readdirSync(resolve(out, "assets")).sort().filter(name => /\.(?:js|css|woff2)$/.test(name)).map(name => `/assets/${name}`)];
      const hash = createHash("sha256");
      for (const file of files) hash.update(readFileSync(resolve(out, file.slice(1))));
      const worker = readFileSync(resolve(root, "scripts/service-worker.js"), "utf8").replace("__VERSION__", JSON.stringify(hash.digest("hex").slice(0, 16))).replace("__FILES__", JSON.stringify(files));
      writeFileSync(resolve(out, "sw.js"), worker);
    },
  };
}
