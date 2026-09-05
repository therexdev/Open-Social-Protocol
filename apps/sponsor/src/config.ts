/**
 * Environment configuration and deployment manifest discovery for the sponsor service.
 *
 * Every knob is an `OSP_*` environment variable (see README.md). `loadConfig` is pure
 * (it reads the `env` object it is given) so tests can build configurations directly.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeployment, type Deployment } from "@osp/sdk";

/** Reported by `/healthz` and the discovery document. */
export const SPONSOR_VERSION = "0.1.0";

export const DEFAULTS = {
  network: "harbinger",
  port: 8788,
  host: "0.0.0.0",
  dailyOps: 200,
  burstOps: 20,
  burstWindowSec: 60,
  maxBytesPerOp: 6144,
  maxRcPerOp: "200000000",
  maxOpsPerTx: 4,
  policyVersion: 1,
  register: true,
} as const;

export interface SponsorConfig {
  /** Deployment network name (`deployments/<network>.json`). */
  network: string;
  /** RPC override (`OSP_RPC`, comma separated); defaults to the deployment's list. */
  rpc: string[] | undefined;
  /** Payer private key (WIF). Required to serve. */
  wif: string | undefined;
  port: number;
  host: string;
  /** Public base URL advertised on chain and in the discovery document. */
  publicUrl: string;
  /** SQLite file for quotas/utilization (`:memory:` allowed). */
  dbPath: string;
  dailyOps: number;
  burstOps: number;
  burstWindowSec: number;
  maxBytesPerOp: number;
  /** Decimal string (uint64). */
  maxRcPerOp: string;
  maxOpsPerTx: number;
  /** Optional `contract:method,...` allowlist override. */
  allowlist: string | undefined;
  /** Policy version advertised in discovery and on chain. */
  policyVersion: number;
  /** Register/update the on-chain sponsor record on start. */
  register: boolean;
  /** Explicit deployment manifest path (overrides network lookup). */
  deploymentFile: string | undefined;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

type Env = Record<string, string | undefined>;

function text(env: Env, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function integer(env: Env, key: string, fallback: number, min = 0): number {
  const raw = text(env, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new ConfigError(`${key} must be an integer >= ${min}, got "${raw}"`);
  return value;
}

function unsigned64(env: Env, key: string, fallback: string): string {
  const raw = text(env, key);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${key} must be an unsigned integer, got "${raw}"`);
  const value = BigInt(raw);
  if (value > 0xffffffffffffffffn) throw new ConfigError(`${key} exceeds uint64`);
  return value.toString();
}

function boolean(env: Env, key: string, fallback: boolean): boolean {
  const raw = text(env, key)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new ConfigError(`${key} must be true or false, got "${raw}"`);
}

/** Builds the configuration from environment variables (defaults documented in README.md). */
export function loadConfig(env: Env = process.env): SponsorConfig {
  const network = text(env, "OSP_NETWORK") ?? DEFAULTS.network;
  if (!/^[a-z0-9_-]+$/i.test(network)) throw new ConfigError(`OSP_NETWORK must be a simple name, got "${network}"`);
  const port = integer(env, "OSP_SPONSOR_PORT", DEFAULTS.port, 0);
  if (port > 65535) throw new ConfigError("OSP_SPONSOR_PORT must be <= 65535");
  const host = text(env, "OSP_SPONSOR_HOST") ?? DEFAULTS.host;
  const publicUrl = (text(env, "OSP_SPONSOR_PUBLIC_URL") ?? `http://localhost:${port}`).replace(/\/+$/, "");
  const rpcRaw = text(env, "OSP_RPC");
  const rpc = rpcRaw
    ? rpcRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : undefined;
  if (rpc && rpc.length === 0) throw new ConfigError("OSP_RPC must list at least one URL");
  const maxOpsPerTx = integer(env, "OSP_SPONSOR_MAX_OPS_PER_TX", DEFAULTS.maxOpsPerTx, 1);
  const dailyOps = integer(env, "OSP_SPONSOR_DAILY_OPS", DEFAULTS.dailyOps, 1);
  const burstOps = integer(env, "OSP_SPONSOR_BURST_OPS", DEFAULTS.burstOps, 1);
  return {
    network,
    rpc,
    wif: text(env, "OSP_SPONSOR_WIF"),
    port,
    host,
    publicUrl,
    dbPath: text(env, "OSP_SPONSOR_DB") ?? join("data", `sponsor-${network}.sqlite`),
    dailyOps,
    burstOps,
    burstWindowSec: integer(env, "OSP_SPONSOR_BURST_WINDOW_SEC", DEFAULTS.burstWindowSec, 1),
    maxBytesPerOp: integer(env, "OSP_SPONSOR_MAX_BYTES_PER_OP", DEFAULTS.maxBytesPerOp, 1),
    maxRcPerOp: unsigned64(env, "OSP_SPONSOR_MAX_RC_PER_OP", DEFAULTS.maxRcPerOp),
    maxOpsPerTx,
    allowlist: text(env, "OSP_SPONSOR_ALLOWLIST"),
    policyVersion: integer(env, "OSP_SPONSOR_POLICY_VERSION", DEFAULTS.policyVersion, 1),
    register: boolean(env, "OSP_SPONSOR_REGISTER", DEFAULTS.register),
    deploymentFile: text(env, "OSP_DEPLOYMENT_FILE"),
  };
}

/** Finds the monorepo root (the directory that contains `deployments/`) walking up from `from`. */
export function findRepoRoot(from: string = dirname(fileURLToPath(import.meta.url))): string | undefined {
  let dir = resolve(from);
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(dir, "deployments")) && existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Resolves the manifest path for the configured network (`OSP_DEPLOYMENT_FILE` wins). */
export function deploymentPath(config: Pick<SponsorConfig, "network" | "deploymentFile">): string {
  if (config.deploymentFile) return isAbsolute(config.deploymentFile) ? config.deploymentFile : resolve(process.cwd(), config.deploymentFile);
  const root = findRepoRoot() ?? findRepoRoot(process.cwd()) ?? process.cwd();
  return join(root, "deployments", `${config.network}.json`);
}

export type DeploymentLookup =
  | { status: "loaded"; path: string; deployment: Deployment }
  | { status: "missing"; path: string }
  | { status: "invalid"; path: string; error: string };

/** Reads the deployment manifest; a missing file is a reportable state, not a crash. */
export function readDeployment(config: Pick<SponsorConfig, "network" | "deploymentFile" | "rpc">): DeploymentLookup {
  const path = deploymentPath(config);
  if (!existsSync(path)) return { status: "missing", path };
  try {
    const deployment = loadDeployment(readFileSync(path, "utf8"));
    return { status: "loaded", path, deployment: config.rpc ? { ...deployment, rpc: config.rpc } : deployment };
  } catch (error) {
    return { status: "invalid", path, error: (error as Error).message };
  }
}
