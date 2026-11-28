import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/** Hostinger serves PHP; crawlers receive post metadata without running JS. */
export function socialPreviewBuild(): Plugin {
  let out = "", api = "", site = "";
  const safe = (value: string) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw Error("Link preview endpoints require public HTTPS URLs");
    return url.href.replace(/\/+$/, "");
  };
  return {
    name: "osp-social-preview", apply: "build",
    configResolved(config) {
      out = resolve(config.root, config.build.outDir);
      const network = config.env.VITE_OSP_NETWORK || "harbinger";
      const file = resolve(config.root, `../../deployments/${network}.json`);
      const deployment = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as { indexers?: string[] } : undefined;
      api = safe(config.env.VITE_OSP_INDEXER_URL || deployment?.indexers?.[0] || "https://api.opensocial.online");
      site = safe(config.env.VITE_OSP_PUBLIC_SITE_URL || "https://opensocial.online");
    },
    transformIndexHtml(html) {
      return html.replaceAll("https://opensocial.online", site);
    },
    closeBundle() {
      const file = resolve(out, "post-preview.php");
      writeFileSync(file, readFileSync(file, "utf8").replace("__OSP_PREVIEW_CONFIG__", Buffer.from(JSON.stringify({ site, api })).toString("base64")));
    },
  };
}
