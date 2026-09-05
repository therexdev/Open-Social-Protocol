#!/usr/bin/env node
// Run as-pect + Koinos mock VM unit tests for every contract directory.
//
//   node scripts/test.mjs            all contracts
//   node scripts/test.mjs identity   one contract
//
// The as-pect asconfig is generated per contract with absolute paths so it works
// with npm workspace hoisting (no node_modules inside the contract directory).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACTS } from "./build.mjs";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const repoRoot = resolve(pkgRoot, "..", "..");

function bin(name) {
  for (const c of [join(pkgRoot, "node_modules", ".bin", name), join(repoRoot, "node_modules", ".bin", name)]) {
    if (existsSync(c)) return c;
  }
  throw new Error(`binary not found: ${name}`);
}

function pkgDir(name) {
  // Packages with strict "exports" cannot be resolved via require.resolve; probe the tree.
  for (const base of [pkgRoot, repoRoot]) {
    const candidate = join(base, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
  }
  throw new Error(`package not found: ${name}`);
}

const aspectAssemblyIndex = join(pkgDir("@as-pect/assembly"), "assembly", "index.ts");
let coversLib = null;
try {
  coversLib = join(pkgDir("@as-covers/assembly"), "index.ts");
} catch {
  coversLib = null;
}

function writeAsconfig(dir) {
  const out = join(dir, "build");
  mkdirSync(out, { recursive: true });
  const config = {
    targets: {
      coverage: {
        ...(coversLib ? { lib: [coversLib] } : {}),
        transform: ["@as-covers/transform", "@as-pect/transform"],
      },
      noCoverage: { transform: ["@as-pect/transform"] },
    },
    options: {
      exportMemory: true,
      outFile: "output.wasm",
      textFile: "output.wat",
      bindings: "raw",
      exportStart: "_start",
      exportRuntime: true,
      use: ["RTRACE=1"],
      debug: true,
      exportTable: true,
    },
    extends: "../asconfig.json",
    entries: [aspectAssemblyIndex],
  };
  const file = join(out, "as-pect.asconfig.json");
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  return file;
}

const only = process.argv[2];
let failed = false;
for (const name of only ? [only] : CONTRACTS) {
  const dir = join(pkgRoot, name);
  if (!existsSync(join(dir, "as-pect.config.js"))) continue;
  if (!existsSync(join(dir, "assembly", "index.ts"))) {
    console.error(`[contracts] ${name}: run scripts/build.mjs first (assembly/index.ts missing)`);
    failed = true;
    continue;
  }
  console.log(`\n[contracts] testing ${name}`);
  const asconfig = writeAsconfig(dir);
  const res = spawnSync(bin("asp"), ["--config", "as-pect.config.js", "--as-config", asconfig], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, OSP_ASPECT_ASSEMBLY_INDEX: aspectAssemblyIndex },
  });
  if (res.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
