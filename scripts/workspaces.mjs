#!/usr/bin/env node
// Run optional workspace tasks without inheriting npm's workspace selection.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const task = process.argv[2];
if (!["typecheck", "lint", "clean"].includes(task)) throw new Error("Expected typecheck, lint, or clean");
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith("npm_config_workspace") || key === "npm_config_include_workspace_root") delete env[key];
}
const { workspaces } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
for (const workspace of workspaces) {
  const cwd = resolve(root, workspace);
  const pkg = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
  if (!pkg.scripts?.[task]) continue;
  console.log(`[${task}] ${workspace}`);
  execFileSync("npm", ["run", task], { cwd, env, stdio: "inherit" });
}
