#!/usr/bin/env node
// Deterministic generator for @osp/proto.
//
// Produces:
//   dist/descriptors/<name>.json  protobufjs JSON descriptor (keepCase) per schema
//   dist/abi/<name>.json          koilib ABI per contract schema
//   dist/index.js, dist/index.d.ts
//
// Contract method discovery follows the Koinos convention used by
// koinos-abi-proto-gen: every message named `<method>_arguments` is a method;
// the comment block directly above it carries `@description` and `@read-only`.
// Entry point = first 4 bytes (big-endian) of sha256(method name).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const schemaDir = join(pkgRoot, "osp");
const includeDir = resolve(pkgRoot, "..", "contracts", "proto-deps");
const distDir = join(pkgRoot, "dist");

export const PROTOCOL_VERSION = 1;
export const CONTRACTS = [
  "identity",
  "relationships",
  "publications",
  "communities",
  "sponsorship",
  "registry",
];
const CLIENT_ONLY = ["envelope"];

function stableStringify(value) {
  // Deterministic JSON with sorted object keys, 2-space indent.
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

function sortKeys(value, parentKey) {
  if (Array.isArray(value)) return value.map((v) => sortKeys(v));
  if (value && typeof value === "object") {
    const out = {};
    // Enum `values` must keep their declaration order: protobufjs uses the FIRST
    // listed value as the default for absent enum fields (proto3 requires it to be
    // the zero value). Everything else is sorted for deterministic output.
    const keys = parentKey === "values" ? Object.keys(value) : Object.keys(value).sort();
    for (const key of keys) out[key] = sortKeys(value[key], key);
    return out;
  }
  return value;
}

function entryPoint(methodName) {
  const digest = createHash("sha256").update(methodName, "utf8").digest();
  return digest.readUInt32BE(0);
}

function parseMethods(protoText) {
  // Walk comment blocks preceding `message <name>_arguments {`.
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
      const name = m[1];
      let description = "";
      let readOnly = null;
      for (const c of pending) {
        if (c.startsWith("@description")) description = c.slice("@description".length).trim();
        if (c.startsWith("@read-only")) readOnly = c.slice("@read-only".length).trim() === "true";
      }
      if (readOnly === null) {
        throw new Error(`method ${name}: missing // @read-only true|false annotation`);
      }
      methods[name] = { description, readOnly };
    }
    if (line.length > 0) pending = [];
  }
  return methods;
}

async function loadRoot(file) {
  const root = new protobuf.Root();
  root.resolvePath = (origin, target) => {
    if (target.startsWith("koinos/") || target.startsWith("google/")) {
      return join(includeDir, target);
    }
    return protobuf.util.path.resolve(origin, target);
  };
  await root.load(file, { keepCase: true });
  root.resolveAll();
  return root;
}

function descriptorFor(root, packageName) {
  // Only emit the package's own namespace plus the koinos options it references
  // (so descriptors stay small and independent of the include tree).
  const full = root.toJSON({ keepComments: false });
  const nested = {};
  const pkgPath = packageName.split(".");
  let cursor = full.nested;
  let target = nested;
  for (let i = 0; i < pkgPath.length; i += 1) {
    const seg = pkgPath[i];
    if (!cursor || !cursor[seg]) throw new Error(`package ${packageName} not found`);
    if (i === pkgPath.length - 1) {
      target[seg] = cursor[seg];
    } else {
      target[seg] = { nested: {} };
      target = target[seg].nested;
      cursor = cursor[seg].nested;
    }
  }
  if (full.nested.koinos) {
    // Keep btype option enum so koilib can decode ADDRESS fields.
    nested.koinos = { nested: { bytes_type: full.nested.koinos.nested.bytes_type } };
  }
  return { nested };
}

function abiFor(root, packageName, methods) {
  const abiMethods = {};
  for (const name of Object.keys(methods).sort()) {
    const argType = `${packageName}.${name}_arguments`;
    const retType = `${packageName}.${name}_result`;
    root.lookupType(argType);
    root.lookupType(retType);
    abiMethods[name] = {
      entry_point: entryPoint(name),
      argument: argType,
      return: retType,
      read_only: methods[name].readOnly,
      description: methods[name].description,
    };
  }
  return { methods: abiMethods, koilib_types: descriptorFor(root, packageName) };
}

function eventsFor(root, packageName) {
  const ns = root.lookup(packageName);
  const names = [];
  for (const nestedName of Object.keys(ns.nested || {})) {
    if (nestedName.endsWith("_event")) names.push(nestedName);
  }
  return names.sort();
}

export async function generate() {
  mkdirSync(join(distDir, "descriptors"), { recursive: true });
  mkdirSync(join(distDir, "abi"), { recursive: true });

  const index = {
    descriptors: {},
    abis: {},
    events: {},
  };

  for (const name of [...CONTRACTS, ...CLIENT_ONLY]) {
    const file = join(schemaDir, `${name}.proto`);
    const text = readFileSync(file, "utf8");
    const pkgMatch = /^package\s+([a-zA-Z0-9_.]+)\s*;/m.exec(text);
    if (!pkgMatch) throw new Error(`${name}.proto: missing package`);
    const packageName = pkgMatch[1];
    const root = await loadRoot(file);
    const descriptor = descriptorFor(root, packageName);
    writeFileSync(join(distDir, "descriptors", `${name}.json`), stableStringify(descriptor));
    index.descriptors[name] = packageName;

    if (CONTRACTS.includes(name)) {
      const methods = parseMethods(text);
      const abi = abiFor(root, packageName, methods);
      writeFileSync(join(distDir, "abi", `${name}.json`), stableStringify(abi));
      index.abis[name] = Object.keys(abi.methods);
      index.events[name] = eventsFor(root, packageName).map((e) => ({
        type: `${packageName}.${e}`,
        name: `osp.${name}.${e.replace(/_event$/, "")}`,
      }));
    }
  }

  const js = [];
  const dts = [];
  js.push("// Generated by scripts/generate.mjs - do not edit.");
  dts.push("// Generated by scripts/generate.mjs - do not edit.");
  js.push(`export const PROTOCOL_VERSION = ${PROTOCOL_VERSION};`);
  dts.push(`export declare const PROTOCOL_VERSION: ${PROTOCOL_VERSION};`);
  js.push(`export const CONTRACT_NAMES = ${JSON.stringify(CONTRACTS)};`);
  dts.push(`export type ContractName = ${CONTRACTS.map((c) => JSON.stringify(c)).join(" | ")};`);
  dts.push(`export declare const CONTRACT_NAMES: readonly ContractName[];`);
  for (const name of [...CONTRACTS, ...CLIENT_ONLY]) {
    const varName = `${name}Descriptor`;
    js.push(`import ${varName} from "./descriptors/${name}.json" with { type: "json" };`);
    dts.push(`export declare const ${varName}: { nested: Record<string, unknown> };`);
  }
  for (const name of CONTRACTS) {
    const varName = `${name}Abi`;
    js.push(`import ${varName} from "./abi/${name}.json" with { type: "json" };`);
    dts.push(
      `export declare const ${varName}: { methods: Record<string, { entry_point: number; argument: string; return: string; read_only: boolean; description: string }>; koilib_types: { nested: Record<string, unknown> } };`
    );
  }
  js.push(
    `export { ${[...CONTRACTS, ...CLIENT_ONLY].map((n) => `${n}Descriptor`).join(", ")}, ${CONTRACTS.map((n) => `${n}Abi`).join(", ")} };`
  );
  js.push(`export const DESCRIPTORS = { ${[...CONTRACTS, ...CLIENT_ONLY].map((n) => `${n}: ${n}Descriptor`).join(", ")} };`);
  dts.push(`export declare const DESCRIPTORS: Record<ContractName | "envelope", { nested: Record<string, unknown> }>;`);
  js.push(`export const ABIS = { ${CONTRACTS.map((n) => `${n}: ${n}Abi`).join(", ")} };`);
  dts.push(`export declare const ABIS: Record<ContractName, typeof identityAbi>;`);
  js.push(`export const PACKAGES = ${JSON.stringify(index.descriptors)};`);
  dts.push(`export declare const PACKAGES: Record<ContractName | "envelope", string>;`);
  js.push(`export const EVENTS = ${JSON.stringify(index.events)};`);
  dts.push(`export declare const EVENTS: Record<ContractName, ReadonlyArray<{ type: string; name: string }>>;`);
  writeFileSync(join(distDir, "index.js"), js.join("\n") + "\n");
  writeFileSync(join(distDir, "index.d.ts"), dts.join("\n") + "\n");
  writeFileSync(join(distDir, "manifest.json"), stableStringify(index));
  return index;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  generate()
    .then((index) => {
      const methodCount = Object.values(index.abis).reduce((n, m) => n + m.length, 0);
      console.log(`@osp/proto: generated ${Object.keys(index.descriptors).length} descriptors, ${Object.keys(index.abis).length} ABIs, ${methodCount} methods`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
