#!/usr/bin/env node
// Run each workspace's test script in its own process (recursion-safe; see
// scripts/build.mjs for why `-w`/`--workspaces` inside a same-named script
// fork-bombs). Then run the deployment-script tests.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACES = [
  "packages/proto",
  "packages/sdk",
  "packages/contracts",
  "apps/indexer",
  "apps/sponsor",
  "apps/web",
  "apps/extension",
];

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith("npm_config_workspace")) delete env[key];
}

let failed = false;
for (const ws of WORKSPACES) {
  const pkgPath = resolve(root, ws, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (!pkg.scripts || !pkg.scripts.test) continue;
  console.log(`\n[test] ${ws}`);
  try {
    execSync("npm test", { cwd: resolve(root, ws), stdio: "inherit", env });
  } catch {
    console.error(`[test] ${ws} FAILED`);
    failed = true;
  }
}

console.log("\n[test] scripts");
try {
  execSync("node --import tsx --test scripts/*.test.ts", { cwd: root, stdio: "inherit", env });
} catch {
  console.error("[test] scripts FAILED");
  failed = true;
}

process.exit(failed ? 1 : 0);
