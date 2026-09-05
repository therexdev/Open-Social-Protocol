#!/usr/bin/env node
// Build pipeline for the Open Social Protocol contracts.
//
//   node scripts/build.mjs generate         copy schemas + generate AS bindings
//   node scripts/build.mjs debug|release    generate + compile every contract
//   node scripts/build.mjs release identity compile a single contract
//
// Per contract <name> (directory packages/contracts/<name>):
//   1. copy ../proto/osp/<name>.proto -> <name>/assembly/proto/<name>.proto
//   2. as-proto-gen  -> <name>/assembly/proto/<name>.ts            (message classes)
//   3. koinos-as-gen -> <name>/assembly/index.ts + *.boilerplate.ts (entry-point dispatch)
//   4. protoc --descriptor_set_out -> Koinos-format ABI (<name>/abi/<name>.abi)
//   5. asc assembly/index.ts -> <name>/build/<mode>/contract.wasm
// Outputs are also collected under build/<mode>/<name>.{wasm,abi,abi.json}.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const repoRoot = resolve(pkgRoot, "..", "..");
const schemaDir = resolve(repoRoot, "packages", "proto", "osp");
const includeDir = join(pkgRoot, "proto-deps");

export const CONTRACTS = ["identity", "relationships", "publications", "communities", "sponsorship", "registry"];
// Schemas a contract needs message classes for (cross-contract calls), besides its own.
export const DEPENDENCIES = {
  identity: [],
  relationships: ["identity"],
  publications: ["identity", "relationships"],
  communities: ["identity"],
  sponsorship: [],
  registry: [],
};

function bin(name) {
  // Resolve a workspace binary regardless of hoisting.
  const candidates = [
    join(pkgRoot, "node_modules", ".bin", name),
    join(repoRoot, "node_modules", ".bin", name),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`binary not found: ${name} (run npm install)`);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with status ${res.status}`);
  }
}

function runProtoc(args, cwd, attempts = 3) {
  const protoc = bin("protoc");
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    const res = spawnSync(protoc, args, { cwd, stdio: "inherit", env: { ...process.env, PATH: `${dirname(protoc)}:${process.env.PATH}` } });
    if (res.status === 0) return;
    lastErr = new Error(`protoc ${args.join(" ")} failed with status ${res.status}`);
  }
  throw lastErr;
}

function plugin(name) {
  return `${process.execPath} ${join(here, "protoc-plugin.mjs")} ${bin(name)}`;
}

function generate(name) {
  const dir = join(pkgRoot, name);
  const assembly = join(dir, "assembly");
  const protoOut = join(assembly, "proto");
  mkdirSync(protoOut, { recursive: true });
  const src = join(schemaDir, `${name}.proto`);
  if (!existsSync(src)) throw new Error(`schema not found: ${src}`);
  copyFileSync(src, join(protoOut, `${name}.proto`));
  const depNames = DEPENDENCIES[name] || [];
  for (const dep of depNames) {
    copyFileSync(join(schemaDir, `${dep}.proto`), join(protoOut, `${dep}.proto`));
  }
  // Shared helpers: copied so relative imports (../proto/identity) resolve per contract.
  // The identity schema is always generated for helpers that need identity types.
  const commonSrc = join(pkgRoot, "common", "assembly");
  const commonOut = join(assembly, "common");
  mkdirSync(commonOut, { recursive: true });
  for (const f of readdirSync(commonSrc)) copyFileSync(join(commonSrc, f), join(commonOut, f));
  if (name !== "identity" && !depNames.includes("identity")) {
    copyFileSync(join(schemaDir, "identity.proto"), join(protoOut, "identity.proto"));
    depNames.push("identity");
  }

  // Message classes for the contract schema and its dependencies.
  runProtoc(
    [`-I${dir}`, `-I${includeDir}`, `--plugin=protoc-gen-as=${wrapperFor("as-proto-gen")}`, `--as_out=${dir}`, `assembly/proto/${name}.proto`, ...depNames.map((d) => `assembly/proto/${d}.proto`)],
    dir
  );
  // Entry-point dispatch (index.ts) and boilerplate.
  runProtoc(
    [`-I${dir}`, `-I${includeDir}`, `--plugin=protoc-gen-as=${wrapperFor("koinos-as-gen")}`, `--as_out=${assembly}`, `assembly/proto/${name}.proto`],
    dir
  );
  // Koinos-format ABI: descriptor set (with imports) + method table.
  const abiDir = join(dir, "abi");
  mkdirSync(abiDir, { recursive: true });
  const descriptorPath = join(abiDir, `${name}.pb`);
  runProtoc([`-I${dir}`, `-I${includeDir}`, "--include_imports", `--descriptor_set_out=${descriptorPath}`, `assembly/proto/${name}.proto`], dir);
  const abi = koinosAbi(name, readFileSync(src, "utf8"), readFileSync(descriptorPath));
  writeFileSync(join(abiDir, `${name}.abi`), JSON.stringify(abi, null, 2) + "\n");
  rmSync(descriptorPath);
}

const wrappers = new Map();
function wrapperFor(pluginName) {
  // protoc requires a single executable path for --plugin; create a tiny shell shim.
  if (wrappers.has(pluginName)) return wrappers.get(pluginName);
  const shimDir = join(pkgRoot, "build", "shims");
  mkdirSync(shimDir, { recursive: true });
  const shim = join(shimDir, `protoc-gen-${pluginName}`);
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${join(here, "protoc-plugin.mjs")}" "${bin(pluginName)}"\n`, { mode: 0o755 });
  wrappers.set(pluginName, shim);
  return shim;
}

function koinosAbi(name, protoText, descriptorBytes) {
  const methods = {};
  const lines = protoText.split(/\r?\n/);
  let pending = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("//")) {
      pending.push(line.slice(2).trim());
      continue;
    }
    const m = /^message\s+([a-z0-9_]+)_arguments\s*\{/.exec(line);
    if (m) {
      const method = m[1];
      let description = "";
      let readOnly = false;
      for (const c of pending) {
        if (c.startsWith("@description")) description = c.slice("@description".length).trim();
        if (c.startsWith("@read-only")) readOnly = c.slice("@read-only".length).trim() === "true";
      }
      const ep = createHash("sha256").update(method).digest().readUInt32BE(0);
      methods[method] = {
        argument: `${name}.${method}_arguments`,
        return: `${name}.${method}_result`,
        description,
        "entry-point": "0x" + ep.toString(16).padStart(8, "0"),
        "read-only": readOnly,
      };
    }
    if (line.length > 0) pending = [];
  }
  return { methods, types: descriptorBytes.toString("base64") };
}

function compile(name, mode) {
  const dir = join(pkgRoot, name);
  const asc = require.resolve("assemblyscript/bin/asc.js", { paths: [pkgRoot, repoRoot] });
  const outDir = join(dir, "build", mode);
  mkdirSync(outDir, { recursive: true });
  const args = [
    asc,
    "assembly/index.ts",
    "--target", mode,
    "--use", "abort=",
    "--use", "BUILD_FOR_TESTING=0",
    "--disable", "sign-extension",
    "--config", "asconfig.json",
  ];
  run(process.execPath, args, { cwd: dir });
  const collected = join(pkgRoot, "build", mode);
  mkdirSync(collected, { recursive: true });
  copyFileSync(join(outDir, "contract.wasm"), join(collected, `${name}.wasm`));
  copyFileSync(join(dir, "abi", `${name}.abi`), join(collected, `${name}.abi`));
  const wasm = readFileSync(join(outDir, "contract.wasm"));
  const abiHash = createHash("sha256").update(readFileSync(join(dir, "abi", `${name}.abi`))).digest("hex");
  const wasmHash = createHash("sha256").update(wasm).digest("hex");
  return { name, mode, bytes: wasm.length, wasmSha256: wasmHash, abiSha256: abiHash };
}

const [, , command = "release", only] = process.argv;
const targets = only ? [only] : CONTRACTS.filter((c) => existsSync(join(pkgRoot, c, "asconfig.json")));
if (targets.length === 0) {
  console.error("no contracts found (expected <name>/asconfig.json)");
  process.exit(1);
}

const summary = [];
for (const name of targets) {
  console.log(`[contracts] generating ${name}`);
  generate(name);
  if (command === "debug" || command === "release") {
    console.log(`[contracts] compiling ${name} (${command})`);
    summary.push(compile(name, command));
  }
}
if (summary.length > 0) {
  const manifestPath = join(pkgRoot, "build", command, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ generatedAt: "build", contracts: summary }, null, 2) + "\n");
  for (const s of summary) console.log(`[contracts] ${s.name}: ${s.bytes} bytes wasm sha256=${s.wasmSha256.slice(0, 16)}...`);
}
