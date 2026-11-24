// Shared helpers for deployment scripts (run with: node --import tsx scripts/<name>.ts).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Provider, Signer } from "koilib";
import { NETWORKS as SDK_NETWORKS } from "@osp/sdk";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTRACT_BUILD_DIR = join(REPO_ROOT, "packages", "contracts", "build", "release");
export const DEPLOYMENTS_DIR = join(REPO_ROOT, "deployments");
export const DEPLOYMENT_PROGRESS_DIR = join(REPO_ROOT, "deployment-progress");
export const CONTRACT_ORDER = ["identity", "relationships", "publications", "communities", "sponsorship", "registry", "messaging", "token"] as const;
export type ContractName = (typeof CONTRACT_ORDER)[number];

export interface NetworkPreset {
  rpc: string[];
  expectedChainId?: string;
  wifEnv: string;
  /** Only for throwaway local devnets (local-koinos "bob" wallet). */
  defaultWif?: string;
}

export const NETWORKS: Record<string, NetworkPreset> = {
  mainnet: { rpc: [...SDK_NETWORKS.mainnet.rpc], expectedChainId: SDK_NETWORKS.mainnet.expectedChainId, wifEnv: "KOINOS_MAINNET_DEPLOYER_WIF" },
  harbinger: {
    rpc: [...SDK_NETWORKS.harbinger.rpc],
    expectedChainId: SDK_NETWORKS.harbinger.expectedChainId,
    wifEnv: "KOINOS_HARBINGER_DEPLOYER_WIF",
  },
  localnet: {
    rpc: ["http://localhost:8080"],
    wifEnv: "KOINOS_LOCALNET_DEPLOYER_WIF",
    defaultWif: "5KYr9D4RJuWHS4rYqfWit5MEQzQHCKxibrJ7UUtFDMnoocrhMoy",
  },
};

export interface DeployedContract {
  reserved?: boolean;
  address: string;
  txId: string;
  block: string;
  wasmSha256: string;
  abiSha256: string;
  rcUsed: string;
}

/** Metadata only; no WIF, seed, or reusable signing key is written to progress. */
export interface PendingContractUpload extends Omit<DeployedContract, "block"> {
  startBlock: string;
  submittedAt: string;
}

export interface Deployment {
  economy?: "token-free" | "token";
  network: string;
  chainId: string;
  rpc: string[];
  protocolVersion: number;
  deployedAt: string;
  deployer: string;
  contracts: Partial<Record<ContractName, DeployedContract>>;
  pendingUploads?: Partial<Record<ContractName, PendingContractUpload>>;
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
  const wif = process.env[preset.wifEnv] || (preset.wifEnv !== "KOINOS_MAINNET_DEPLOYER_WIF" ? process.env.KOINOS_DEPLOYER_WIF || preset.defaultWif : undefined);
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

export function requireSeed(network?: string): string {
  const seed = network === "mainnet" ? process.env.OSP_MAINNET_CONTRACT_SEED : process.env.OSP_CONTRACT_SEED;
  const minimum = network === "mainnet" ? 32 : 16;
  if (!seed || seed.length < minimum) {
    throw new Error(`${network === "mainnet" ? "OSP_MAINNET_CONTRACT_SEED" : "OSP_CONTRACT_SEED"} must be set to a long random string (>= ${minimum} chars); contract addresses derive from it`);
  }
  return seed;
}

export function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function deploymentPath(network: string, progress = false): string {
  return join(progress ? DEPLOYMENT_PROGRESS_DIR : DEPLOYMENTS_DIR, `${network}.json`);
}

export function readDeployment(network: string, progress = false): Deployment | null {
  const file = deploymentPath(network, progress);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Deployment;
}

export function writeDeployment(deployment: Deployment, progress = false): string {
  const file = deploymentPath(deployment.network, progress);
  mkdirSync(dirname(file), { recursive: true });
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
