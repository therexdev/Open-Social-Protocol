import { version } from "./package.json" with { type: "json" };
import { FACEBOOK_ORIGINS, X_ORIGINS, FEED_ORIGINS } from "./src/shared/hosts.ts";
import { defineManifest } from "@crxjs/vite-plugin";

/**
 * Manifest V3. No static content scripts and no remotely hosted code: the Facebook adapter is
 * registered at runtime (chrome.scripting.registerContentScripts) only after the user grants the
 * optional host permission from the options page. Clicking the action opens the side panel
 * (chrome.sidePanel.setPanelBehavior in the service worker).
 */
export default defineManifest({
  manifest_version: 3,
  name: "Open Social Protocol",
  version,
  description: "Open Social: posts, voice, video, music, groups and encrypted messages, with optional Facebook and X feed integration.",
  minimum_chrome_version: "116",
  icons: {
    16: "public/icons/icon-16.png",
    32: "public/icons/icon-32.png",
    48: "public/icons/icon-48.png",
    128: "public/icons/icon-128.png",
  },
  action: {
    default_title: "Open Social Protocol",
    default_icon: {
      16: "public/icons/icon-16.png",
      32: "public/icons/icon-32.png",
    },
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  options_page: "src/options/index.html",
  web_accessible_resources: [{ resources: ["src/embed/index.html"], matches: [...FACEBOOK_ORIGINS, ...X_ORIGINS] }],
  permissions: ["storage", "sidePanel", "scripting", "alarms", "activeTab"],
  optional_host_permissions: [...FACEBOOK_ORIGINS, ...X_ORIGINS],
  content_security_policy: {
    extension_pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; frame-ancestors 'self' ${FEED_ORIGINS.join(" ")}`,
  },
});
