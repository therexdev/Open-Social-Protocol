// Firefox has event-page background scripts, rather than Chrome service workers/sidePanel.
// Bundle the same client and adapters; keep a separate output so Chrome packaging is unchanged.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
process.env.VITE_OSP_NETWORK ||= 'mainnet';
process.env.OSP_BROWSER = 'firefox';
process.env.VITE_OSP_BROWSER = 'firefox';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const { FACEBOOK_ORIGINS, X_ORIGINS, FEED_ORIGINS } = await import('../src/shared/hosts.ts');
const outDir = 'dist-firefox';
await build({ root, configFile: false, publicDir: false, plugins: [react()], build: {
  outDir, target: 'es2022', sourcemap: false,
  rollupOptions: { input: ['src/sidepanel/index.html', 'src/options/index.html', 'src/embed/index.html', 'src/permissions/index.html'] },
}});
await build({ root, configFile: false, publicDir: false, define: { 'process.env.NODE_ENV': '"production"' }, build: {
  outDir, emptyOutDir: false, target: 'es2022', sourcemap: false,
  lib: { entry: path.join(root, 'src/background/index.ts'), name: 'ospBackground', formats: ['iife'], fileName: () => 'background.js' },
  rollupOptions: { output: { inlineDynamicImports: true } },
}});
await import('./build-content.mjs');
cpSync('public/icons', `${outDir}/public/icons`, { recursive: true });
const deployment = JSON.parse(readFileSync(`../../deployments/${process.env.VITE_OSP_NETWORK}.json`, 'utf8'));
const networkOrigins = [...new Set([...deployment.rpc, ...deployment.indexers, ...deployment.sponsors].map(url => `${new URL(url).origin}/*`))];
writeFileSync(`${outDir}/manifest.json`, JSON.stringify({
  manifest_version: 3, name: 'Open Social Protocol', version,
  description: 'Open Social posts and interactions in Facebook and X, with optional automatic cross-posting.',
  icons: { 48: 'public/icons/icon-48.png', 128: 'public/icons/icon-128.png' },
  action: { default_title: 'Open Social', default_icon: { 32: 'public/icons/icon-32.png' } },
  background: { scripts: ['background.js'] },
  options_ui: { page: 'src/options/index.html', open_in_tab: true },
  permissions: ['storage', 'scripting', 'alarms', 'activeTab'],
  host_permissions: networkOrigins,
  optional_host_permissions: [...FACEBOOK_ORIGINS, ...X_ORIGINS],
  web_accessible_resources: [{ resources: ['src/embed/index.html'], matches: [...FACEBOOK_ORIGINS, ...X_ORIGINS] }],
  content_security_policy: { extension_pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; frame-ancestors 'self' ${FEED_ORIGINS.join(' ')}` },
  browser_specific_settings: {
    gecko: { id: 'opensocial@opensocial.online', strict_min_version: '140.0',
      data_collection_permissions: { required: ['personalCommunications', 'personallyIdentifyingInfo', 'websiteContent'], optional: [] } },
    gecko_android: { strict_min_version: '142.0' },
  },
}, null, 2) + '\n');
await import('./build-release.mjs');
console.log(`Firefox ${version}: ${outDir}/ (unsigned; Mozilla signing required for Android installation)`);
