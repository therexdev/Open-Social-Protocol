#!/usr/bin/env node
// Build the named workspaces in order, each in its own process.
//
//   node scripts/build.mjs packages/proto packages/sdk apps/web
//
// npm's `-w`/`--workspace` filter is inherited by child `npm run` calls through
// the environment (npm_config_workspace), so `npm run build -w a -w b` executed
// from a script *named* build re-enters itself and fork-bombs. This orchestrator
// avoids `-w` entirely: it runs `npm run build` with cwd set to each workspace
// (resolving that workspace's own build script) and a sanitized environment.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("usage: node scripts/build.mjs <workspace-dir> [<workspace-dir> ...]");
  process.exit(1);
}

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key === "npm_config_workspace" || key === "npm_config_workspaces" || key === "npm_config_include_workspace_root") {
    delete env[key];
  }
}

for (const target of targets) {
  const dir = resolve(root, target);
  if (!existsSync(resolve(dir, "package.json"))) {
    console.error(`[build] ${target}: no package.json`);
    process.exit(1);
  }
  console.log(`\n[build] ${target}`);
  try {
    execSync("npm run build", { cwd: dir, stdio: "inherit", env });
  } catch (err) {
    console.error(`[build] ${target} failed`);
    process.exit(typeof err.status === "number" ? err.status : 1);
  }
}
console.log("\n[build] all done:", targets.join(", "));
