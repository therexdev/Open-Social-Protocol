/**
 * Settings (no secrets): network, endpoints, adapter toggles and auto-lock. Persisted in
 * chrome.storage.local under SETTINGS_KEY by the service worker; pages read/write through messages.
 */
import type { Deployment } from "@osp/sdk";
import { DEPLOYMENTS, DEPLOYMENT_REGISTRY, ENV, presetRpc, type EnvDefaults } from "./config";

export type PaymentPreference = "sponsor-then-self" | "self-only" | "sponsor-only";

export interface Settings {
  network: string;
  /** Empty: use the deployment / preset RPC list. */
  rpcUrls: string[];
  /** Empty: use VITE_OSP_INDEXER_URL, then the deployment's first indexer. */
  indexerUrl: string;
  /** Empty: use VITE_OSP_SPONSOR_URL, then the deployment's sponsors. */
  sponsorUrls: string[];
  payment: PaymentPreference;
  autoLockMinutes: number;
  /** Facebook adapter wanted by the user (the host permission must also be granted). */
  facebookAdapter: boolean;
  /** Labeled protocol posts inserted into the host feed (off by default). */
  feedInsertion: boolean;
}

export const SETTINGS_KEY = "osp.settings";

export function defaultSettings(env: EnvDefaults = ENV): Settings {
  return {
    network: env.network,
    rpcUrls: [],
    indexerUrl: "",
    sponsorUrls: [],
    payment: "sponsor-then-self",
    autoLockMinutes: 15,
    facebookAdapter: false,
    feedInsertion: false,
  };
}

const URL_RE = /^https?:\/\/[^\s]+$/i;

function urls(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && URL_RE.test(x)).map((x) => x.replace(/\/+$/, "")) : [];
}

export function sanitizeSettings(raw: unknown, defaults: Settings = defaultSettings()): Settings {
  if (!raw || typeof raw !== "object") return defaults;
  const r = raw as Record<string, unknown>;
  const payment = r.payment;
  const validPayment = payment === "sponsor-then-self" || payment === "self-only" || payment === "sponsor-only" ? payment : defaults.payment;
  const autoLock = typeof r.autoLockMinutes === "number" && Number.isFinite(r.autoLockMinutes) && r.autoLockMinutes >= 0 ? Math.min(r.autoLockMinutes, 24 * 60) : defaults.autoLockMinutes;
  return {
    network: typeof r.network === "string" && /^[a-z0-9-]{1,32}$/i.test(r.network) ? r.network : defaults.network,
    rpcUrls: urls(r.rpcUrls),
    indexerUrl: typeof r.indexerUrl === "string" && (r.indexerUrl === "" || URL_RE.test(r.indexerUrl)) ? r.indexerUrl.replace(/\/+$/, "") : "",
    sponsorUrls: urls(r.sponsorUrls),
    payment: validPayment,
    autoLockMinutes: autoLock,
    facebookAdapter: r.facebookAdapter === true,
    feedInsertion: r.feedInsertion === true,
  };
}

/** Everything the data layer needs, after applying overrides and defaults. */
export interface ResolvedSettings {
  network: string;
  deployment?: Deployment;
  deployed: boolean;
  /** Why the network is not deployed (manifest missing or invalid). */
  deploymentMessage?: string;
  chainId?: string;
  rpcUrls: string[];
  indexerUrl: string;
  sponsorUrls: string[];
  payment: PaymentPreference;
}

export interface ResolveOptions {
  deployments?: Record<string, Deployment>;
  deploymentErrors?: Record<string, string>;
  env?: EnvDefaults;
}

export function resolveSettings(settings: Settings, options: ResolveOptions = {}): ResolvedSettings {
  const deployments = options.deployments ?? DEPLOYMENTS;
  const errors = options.deploymentErrors ?? DEPLOYMENT_REGISTRY.errors;
  const env = options.env ?? ENV;
  const deployment = deployments[settings.network];
  const rpcUrls = settings.rpcUrls.length > 0 ? settings.rpcUrls : env.rpcUrls.length > 0 ? env.rpcUrls : presetRpc(settings.network, deployments);
  const indexerUrl = (settings.indexerUrl || env.indexerUrl || deployment?.indexers?.[0] || "").replace(/\/+$/, "");
  const sponsorUrls = settings.sponsorUrls.length > 0 ? settings.sponsorUrls : env.sponsorUrls.length > 0 ? env.sponsorUrls : (deployment?.sponsors ?? []);
  const deploymentMessage = deployment
    ? undefined
    : errors[settings.network]
      ? `deployments/${settings.network}.json is invalid: ${errors[settings.network]}`
      : `Protocol contracts are not deployed on ${settings.network} yet (deployments/${settings.network}.json is missing).`;
  return {
    network: settings.network,
    ...(deployment && { deployment, chainId: deployment.chainId }),
    deployed: deployment !== undefined,
    ...(deploymentMessage && { deploymentMessage }),
    rpcUrls,
    indexerUrl,
    sponsorUrls,
    payment: settings.payment,
  };
}

/** A settings-independent signature used to cache clients. */
export function settingsSignature(resolved: ResolvedSettings): string {
  return JSON.stringify([resolved.network, resolved.chainId, resolved.rpcUrls, resolved.indexerUrl, resolved.sponsorUrls, resolved.payment]);
}
