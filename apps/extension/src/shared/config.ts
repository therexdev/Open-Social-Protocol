/**
 * Build-time configuration: deployment manifests discovered from the repository root
 * (deployments/<network>.json, produced by the deploy-testnet workflow) and VITE_OSP_* defaults.
 * Runtime overrides live in the settings (src/shared/settings.ts).
 */
import { NETWORKS, loadDeployment, type Deployment } from "@osp/sdk";

const manifests = import.meta.glob("../../../../deployments/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

export interface DeploymentRegistry {
  deployments: Record<string, Deployment>;
  /** Manifests that exist but failed validation, by network name. */
  errors: Record<string, string>;
}

export function buildDeploymentRegistry(files: Record<string, unknown>): DeploymentRegistry {
  const registry: DeploymentRegistry = { deployments: {}, errors: {} };
  for (const [path, raw] of Object.entries(files)) {
    const name = path.split("/").pop()?.replace(/\.json$/, "") ?? path;
    try {
      const deployment = loadDeployment(raw);
      registry.deployments[deployment.network || name] = deployment;
    } catch (error) {
      registry.errors[name] = error instanceof Error ? error.message : String(error);
    }
  }
  return registry;
}

export const DEPLOYMENT_REGISTRY: DeploymentRegistry = buildDeploymentRegistry(manifests);
export const DEPLOYMENTS = DEPLOYMENT_REGISTRY.deployments;

export function parseList(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface EnvDefaults {
  network: string;
  rpcUrls: string[];
  indexerUrl: string;
  sponsorUrls: string[];
}

function env(name: keyof ImportMetaEnv): string {
  try {
    return (import.meta.env?.[name] ?? "").trim();
  } catch {
    return "";
  }
}

export const ENV: EnvDefaults = {
  network: env("VITE_OSP_NETWORK") || "harbinger",
  rpcUrls: parseList(env("VITE_OSP_RPC_URLS")),
  indexerUrl: env("VITE_OSP_INDEXER_URL"),
  sponsorUrls: parseList(env("VITE_OSP_SPONSOR_URL")),
};

/** Networks the options page offers: presets plus every discovered manifest. */
export function knownNetworks(deployments: Record<string, Deployment> = DEPLOYMENTS): string[] {
  return [...new Set<string>([...Object.keys(NETWORKS), ...Object.keys(deployments)])];
}

/** RPC endpoints a network uses when nothing overrides them. */
export function presetRpc(network: string, deployments: Record<string, Deployment> = DEPLOYMENTS): string[] {
  const deployment = deployments[network];
  if (deployment) return deployment.rpc;
  const preset = (NETWORKS as Record<string, { rpc: string[] } | undefined>)[network];
  return preset?.rpc ?? [];
}

export const APP_NAME = "Open Social Protocol";
export const APP_VERSION = "0.1.0";
export const DEVICE_LABEL = "Chrome extension";
/** Device authorizations last 30 days (spec section 3.1: devices carry an expiry). */
export const DEVICE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
export const FACEBOOK_ORIGINS = ["https://www.facebook.com/*", "https://web.facebook.com/*"];
