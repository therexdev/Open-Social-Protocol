import { readFileSync, writeFileSync } from "node:fs";
const web = JSON.parse(readFileSync(new URL("../../web/public/release.json", import.meta.url), "utf8"));
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
writeFileSync(new URL("../dist/release.json", import.meta.url), JSON.stringify({ ...web, product: "Open Social Chrome extension", extensionVersion: version, bundledSocialClient: 1, browserTools: 1, recordingPermissionSetup: 1, facebookFeedPlacement: 2 }, null, 2) + "\n");
writeFileSync(new URL("../dist/TESTING.md", import.meta.url), readFileSync(new URL("../../../docs/chrome-extension-0.2.1.md", import.meta.url)));
