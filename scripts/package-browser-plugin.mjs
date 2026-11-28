// Ship a real installable Chrome ZIP alongside the website, never inside the
// extension itself. Both clients must already be built so there is no build cycle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = name => JSON.parse(readFileSync(path.join(root, name), "utf8"));
const { version } = read("apps/extension/package.json");
const manifest = read("apps/extension/dist/manifest.json");
const release = read("apps/extension/dist/release.json");
assert.equal(manifest.version, version, "Rebuild the extension before packaging it");
assert.equal(manifest.version_name, `${version} beta`);
assert.equal(release.extensionVersion, version);
assert.equal(release.channel, "beta");
assert.equal(release.standaloneProtocolClient, 1);
assert.ok(existsSync(path.join(root, "apps/web/dist/index.html")), "Build the website first");
for (const entry of [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_page]) {
  assert.ok(existsSync(path.join(root, "apps/extension/dist", entry)), `Missing extension entry: ${entry}`);
}
const zipped = spawnSync(process.execPath, [path.join(root, "apps/extension/scripts/zip.mjs")], { cwd: root, stdio: "inherit" });
assert.equal(zipped.status, 0, "Extension ZIP failed");
const bytes = readFileSync(path.join(root, "apps/extension/dist.zip"));
// Verify the packaged local entries, including decompressed manifest/metadata.
const { inflateRawSync } = await import("node:zlib");
const files = new Map();
let cursor = 0;
while (bytes.readUInt32LE(cursor) === 0x04034b50) {
  const method = bytes.readUInt16LE(cursor + 8), length = bytes.readUInt32LE(cursor + 18);
  const nameLength = bytes.readUInt16LE(cursor + 26), extra = bytes.readUInt16LE(cursor + 28);
  const name = bytes.subarray(cursor + 30, cursor + 30 + nameLength).toString();
  const start = cursor + 30 + nameLength + extra;
  assert(!name.endsWith(".zip") && !name.startsWith("downloads/"), "A download was recursively bundled into the plugin");
  const body = bytes.subarray(start, start + length);
  files.set(name, method === 8 ? inflateRawSync(body) : body);
  cursor = start + length;
}
assert.equal(JSON.parse(files.get("manifest.json").toString()).version, version);
assert.equal(JSON.parse(files.get("release.json").toString()).network, release.network);
assert(files.has("INSTALL.md"), "ZIP needs offline installation directions");
assert.equal(bytes.readUInt32LE(cursor), 0x02014b50, "Invalid ZIP directory");
const downloads = path.join(root, "apps/web/dist/downloads");
rmSync(downloads, { recursive: true, force: true });
mkdirSync(downloads, { recursive: true });
const filename = `OpenSocial-Chrome-Beta-${version}.zip`;
const sha256 = createHash("sha256").update(bytes).digest("hex");
writeFileSync(path.join(downloads, filename), bytes);
writeFileSync(path.join(downloads, `${filename}.sha256`), `${sha256}  ${filename}\n`);
writeFileSync(path.join(downloads, "browser-plugin.json"), JSON.stringify({ version, channel: "beta", network: release.network, filename, bytes: bytes.length, sha256 }, null, 2) + "\n");
console.log(`Chrome beta ${version}: ${bytes.length} bytes, ${release.network}, SHA-256 ${sha256}`);
