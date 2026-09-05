/**
 * Indexer configuration from the environment (see README.md, "Configuration").
 *
 * The deployment manifest `deployments/<network>.json` is produced by the deploy-testnet
 * workflow. When it is missing the indexer still starts, in "not deployed" mode: the API
 * answers `/v1/status` with `healthy: false` and every data route with 503 `not_deployed`.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NETWORKS, loadDeployment, type Deployment } from "@osp/sdk";

/** Monorepo root (this file lives in apps/indexer/{src,dist}). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export interface IndexerConfig {
  network: string;
  /** Path of the deployment manifest that was (or would have been) loaded. */
  deploymentPath: string;
  /** Absent in "not deployed" mode. */
  deployment?: Deployment;
  /** Why no deployment is loaded, when `deployment` is absent. */
  deploymentError?: string;
  rpc: string[];
  dbPath: string;
  port: number;
  host: string;
  startHeight: number;
  pollIntervalMs: number;
  batchSize: number;
  /** Optional override of the reversible window (blocks below head - window count as final). */
  reversibleWindow?: number;
  version: string;
}

export const DEFAULTS = {
  network: "harbinger",
  port: 8787,
  host: "0.0.0.0",
  pollIntervalMs: 2000,
  batchSize: 50,
  startHeight: 1,
} as const;

export type Env = Record<string, string | undefined>;

export interface LoadConfigOptions {
  /** Directory holding `<network>.json` manifests (default: `<repo>/deployments`). */
  deploymentsDir?: string;
  /** Explicit deployment (skips the manifest lookup). */
  deployment?: Deployment;
}

/** The indexer's own package version. */
export function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function intEnv(env: Env, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${key} must be an integer >= ${min}, got "${raw}"`);
  return n;
}

function listEnv(env: Env, key: string): string[] | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

/** Reads a deployment manifest file; returns an error message instead of throwing. */
export function readDeploymentFile(file: string): { deployment?: Deployment; error?: string } {
  if (!existsSync(file)) return { error: `deployment manifest not found: ${file}` };
  try {
    return { deployment: loadDeployment(readFileSync(file, "utf8")) };
  } catch (error) {
    return { error: `invalid deployment manifest ${file}: ${(error as Error).message}` };
  }
}

/** Builds the configuration from `env` (defaults to `process.env`). */
export function loadConfig(env: Env = process.env, options: LoadConfigOptions = {}): IndexerConfig {
  const network = env.OSP_NETWORK?.trim() || DEFAULTS.network;
  const deploymentsDir = options.deploymentsDir ?? env.OSP_DEPLOYMENTS_DIR ?? path.join(REPO_ROOT, "deployments");
  const deploymentPath = env.OSP_DEPLOYMENT ?? path.join(deploymentsDir, `${network}.json`);

  let deployment = options.deployment;
  let deploymentError: string | undefined;
  if (!deployment) {
    const loaded = readDeploymentFile(deploymentPath);
    deployment = loaded.deployment;
    deploymentError = loaded.error;
  }

  const preset = (NETWORKS as Record<string, { rpc: string[] } | undefined>)[network];
  const rpc = listEnv(env, "OSP_RPC") ?? deployment?.rpc ?? preset?.rpc ?? [];

  const startHeight = intEnv(
    env,
    "OSP_START_HEIGHT",
    deployment?.startHeight !== undefined ? Number(deployment.startHeight) : DEFAULTS.startHeight,
    0,
  );
  const reversibleWindowRaw = env.OSP_REVERSIBLE_WINDOW;
  const reversibleWindow =
    reversibleWindowRaw !== undefined && reversibleWindowRaw.trim() !== "" ? intEnv(env, "OSP_REVERSIBLE_WINDOW", 0, 0) : undefined;

  return {
    network,
    deploymentPath,
    ...(deployment && { deployment }),
    ...(deploymentError && { deploymentError }),
    rpc,
    dbPath: env.OSP_INDEXER_DB?.trim() || path.join("data", `indexer-${network}.sqlite`),
    port: intEnv(env, "OSP_INDEXER_PORT", DEFAULTS.port, 0),
    host: env.OSP_INDEXER_HOST?.trim() || DEFAULTS.host,
    startHeight: Math.max(startHeight, 1),
    pollIntervalMs: intEnv(env, "OSP_POLL_INTERVAL_MS", DEFAULTS.pollIntervalMs, 1),
    batchSize: intEnv(env, "OSP_BATCH_SIZE", DEFAULTS.batchSize, 1),
    ...(reversibleWindow !== undefined && { reversibleWindow }),
    version: packageVersion(),
  };
}
