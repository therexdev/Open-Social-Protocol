import { version } from "../../../../extension/package.json";

export const BROWSER_PLUGIN = {
  version,
  channel: "Beta",
  page: "/browser-plugin",
  website: "https://opensocial.online/browser-plugin",
  download: `https://opensocial.online/downloads/OpenSocial-Chrome-Beta-${version}.zip`,
  checksum: `https://opensocial.online/downloads/OpenSocial-Chrome-Beta-${version}.zip.sha256`,
  chromeGuide: "https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked",
} as const;
