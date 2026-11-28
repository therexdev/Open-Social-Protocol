import { readFileSync, writeFileSync, existsSync } from "node:fs";
const web = JSON.parse(readFileSync(new URL("../../web/public/release.json", import.meta.url), "utf8"));
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const network = process.env.VITE_OSP_NETWORK || "harbinger";
const deploymentPath = new URL(`../../../deployments/${network}.json`, import.meta.url);
const deployment = existsSync(deploymentPath) ? JSON.parse(readFileSync(deploymentPath, "utf8")) : undefined;
const free = deployment?.economy === "token-free";
const firefox = process.env.OSP_BROWSER === 'firefox';
if (firefox) {
  const out = new URL('../dist-firefox/', import.meta.url);
  writeFileSync(new URL('release.json', out), JSON.stringify({ network, channel: 'beta', product: 'Open Social Firefox extension', extensionVersion: version, bundledSocialClient: 0, standaloneProtocolClient: 1, firefoxAndroid: 1, mobileFacebook: 1, xFeedIntegration: 1, hostedContent: 1, tokenEconomy: free ? 0 : 1 }, null, 2) + '\n');
  writeFileSync(new URL('INSTALL.md', out), readFileSync(new URL('../../../docs/firefox-android-extension.md', import.meta.url)));
} else {
writeFileSync(new URL("../dist/release.json", import.meta.url), JSON.stringify({ ...web, network, channel: "beta", release: "2026-11-27-feed-history-polish", ...(free && { tokenEconomy: 0, walletTransfers: 0, musicNativeFees: 0, videoFlatPricing: 0, automaticOsatRewards: 0, headerOsatTotal: 0 }), hostedContent: 1, nativeHostedPlayback: 1, hiddenManaCounter: free ? 1 : 0, freeUsageDialog: 1, product: "Open Social Chrome extension", extensionVersion: version, bundledSocialClient: 0, standaloneProtocolClient: 1, browserTools: 1, recordingPermissionSetup: 1, facebookFeedPlacement: 2, facebookInlineActions: 1, facebookMediaPlayback: 1, facebookCardStyle: 2, facebookProfilePhotos: 1, facebookTheme: 1, facebookCrosspostDefaults: 1, facebookPermalinks: 2, facebookPublishingRecovery: 1, xFeedIntegration: 1, xCrosspostDefaults: 1, xPermalinks: 1, xDraftEditorInsertion: 1, staleExtensionContextRecovery: 1 }, null, 2) + "\n");
writeFileSync(new URL("../dist/TESTING.md", import.meta.url), readFileSync(new URL(`../../../docs/chrome-extension-${version}.md`, import.meta.url)));

writeFileSync(new URL("../dist/INSTALL.md", import.meta.url), readFileSync(new URL(`../../../docs/chrome-extension-${version}.md`, import.meta.url)));
}
