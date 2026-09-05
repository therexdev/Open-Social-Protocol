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
  version: "0.1.0",
  description: "Encrypted social protocol on Koinos: feed and composer in the side panel, optional labeled cross-posting from Facebook.",
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
  permissions: ["storage", "sidePanel", "scripting", "alarms", "activeTab"],
  optional_host_permissions: ["https://www.facebook.com/*", "https://web.facebook.com/*"],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
});
