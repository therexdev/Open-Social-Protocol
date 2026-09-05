// Shared helpers for deployment scripts (run with: node --import tsx scripts/<name>.ts).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Provider, Signer } from "koilib";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTRACT_BUILD_DIR = join(REPO_ROOT, "packages", "contracts", "build", "release");
export const DEPLOYMENTS_DIR = join(REPO_ROOT, "deployments");
export const CONTRACT_ORDER = ["identity", "relationships", "publications", "communities", "sponsorship", "registry"] as const;
export type ContractName = (typeof CONTRACT_ORDER)[number];

export interface NetworkPreset {
  rpc: string[];
  expectedChainId?: string;
  wifEnv: string;
  /** Only for throwaway local devnets (local-koinos "bob" wallet). */
  defaultWif?: string;
}

export const NETWORKS: Record<string, NetworkPreset> = {
  harbinger: {
    rpc: ["https://harbinger-api.koinos.io", "https://api.harbinger.koinos.pro"],
    expectedChainId: "EiBncD4pKRIQWco_WRqo5Q-xnXR7JuO3PtZv983mKdKHSQ==",
    wifEnv: "KOINOS_HARBINGER_DEPLOYER_WIF",
  },
  localnet: {
    rpc: ["http://localhost:8080"],
    wifEnv: "KOINOS_LOCALNET_DEPLOYER_WIF",
    defaultWif: "5KYr9D4RJuWHS4rYqfWit5MEQzQHCKxibrJ7UUtFDMnoocrhMoy",
  },
};

export interface DeployedContract {
  address: string;
  txId: string;
  block: string;
  wasmSha256: string;
  abiSha256: string;
  rcUsed: string;
}

export interface Deployment {
  network: string;
  chainId: string;
  rpc: string[];
  protocolVersion: number;
  deployedAt: string;
  deployer: string;
  contracts: Partial<Record<ContractName, DeployedContract>>;
  startHeight?: string;
  registryAdmin?: string;
  upgradeDelayMs?: string;
  indexers?: string[];
  sponsors?: string[];
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export function networkFromArgs(args: Record<string, string | boolean>): { name: string; preset: NetworkPreset } {
  const name = typeof args.network === "string" ? args.network : "harbinger";
  const base = NETWORKS[name];
  if (!base && typeof args.rpc !== "string") {
    throw new Error(`unknown network "${name}"; pass --rpc <url[,url]> for a custom network`);
  }
  const preset: NetworkPreset = base ? { ...base } : { rpc: [], wifEnv: "KOINOS_DEPLOYER_WIF" };
  if (typeof args.rpc === "string") preset.rpc = args.rpc.split(",").map((s) => s.trim()).filter(Boolean);
  if (process.env.KOINOS_RPC) preset.rpc = process.env.KOINOS_RPC.split(",").map((s) => s.trim()).filter(Boolean);
  return { name, preset };
}

export function providerFor(preset: NetworkPreset): Provider {
  return new Provider(preset.rpc);
}

export function deployerSigner(preset: NetworkPreset, provider: Provider): Signer {
  const wif = process.env[preset.wifEnv] || process.env.KOINOS_DEPLOYER_WIF || preset.defaultWif;
  if (!wif) {
    throw new Error(`missing deployer key: set ${preset.wifEnv} (WIF of a funded account)`);
  }
  const signer = Signer.fromWif(wif);
  signer.provider = provider;
  return signer;
}

/** Deterministic contract account: sha256("osp/v1/<network>/<name>/<seed>") as private key. */
export function contractSigner(network: string, name: string, seed: string, provider: Provider): Signer {
  const signer = Signer.fromSeed(`osp/v1/${network}/${name}/${seed}`);
  signer.provider = provider;
  return signer;
}

export function requireSeed(): string {
  const seed = process.env.OSP_CONTRACT_SEED;
  if (!seed || seed.length < 16) {
    throw new Error("OSP_CONTRACT_SEED must be set to a long random string (>= 16 chars); contract addresses derive from it");
  }
  return seed;
}

export function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function deploymentPath(network: string): string {
  return join(DEPLOYMENTS_DIR, `${network}.json`);
}

export function readDeployment(network: string): Deployment | null {
  const file = deploymentPath(network);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Deployment;
}

export function writeDeployment(deployment: Deployment): string {
  mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const file = deploymentPath(deployment.network);
  writeFileSync(file, JSON.stringify(deployment, null, 2) + "\n");
  return file;
}

export function readContractArtifacts(name: ContractName): { wasm: Buffer; abi: string; wasmSha256: string; abiSha256: string } {
  const wasmPath = join(CONTRACT_BUILD_DIR, `${name}.wasm`);
  const abiPath = join(CONTRACT_BUILD_DIR, `${name}.abi`);
  if (!existsSync(wasmPath) || !existsSync(abiPath)) {
    throw new Error(`missing build artifacts for ${name}; run: npm run build -w packages/contracts`);
  }
  const wasm = readFileSync(wasmPath);
  const abi = readFileSync(abiPath, "utf8");
  return { wasm, abi, wasmSha256: sha256Hex(wasm), abiSha256: sha256Hex(Buffer.from(abi, "utf8")) };
}

export function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

export function formatMana(rc: string | number | undefined): string {
  if (rc === undefined) return "?";
  const n = typeof rc === "string" ? Number(rc) : rc;
  return `${(n / 1e8).toFixed(8)} mana (${n} RC)`;
}
