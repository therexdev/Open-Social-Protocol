/**
 * Settings: network, endpoints (RPC / indexer / sponsors), payment preference and auto-lock.
 * Persisted in localStorage (no secrets). Empty overrides mean "use the build defaults".
 */
import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { Deployment } from "@osp/sdk";
import { DEPLOYMENTS, DEPLOYMENT_REGISTRY, ENV, parseList, presetRpc, type EnvDefaults } from "../config";
import { safeLocalStorage, type StringStorage } from "../util/webStorage";

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
  /** Everyone-audience posts from accounts you muted (client only). */
  muted: string[];
}

export interface SettingsState extends Settings {
  update(patch: Partial<Settings>): void;
  reset(): void;
}

export const SETTINGS_KEY = "osp.web.settings";

export function defaultSettings(env: EnvDefaults = ENV): Settings {
  return {
    network: env.network,
    rpcUrls: [],
    indexerUrl: "",
    sponsorUrls: [],
    payment: "sponsor-then-self",
    autoLockMinutes: 15,
    muted: [],
  };
}

function sanitize(raw: unknown, defaults: Settings): Settings {
  if (!raw || typeof raw !== "object") return defaults;
  const r = raw as Record<string, unknown>;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : []);
  const payment = r.payment;
  const validPayment = payment === "sponsor-then-self" || payment === "self-only" || payment === "sponsor-only" ? payment : defaults.payment;
  const autoLock = typeof r.autoLockMinutes === "number" && Number.isFinite(r.autoLockMinutes) && r.autoLockMinutes >= 0 ? r.autoLockMinutes : defaults.autoLockMinutes;
  return {
    network: typeof r.network === "string" && r.network.length > 0 ? r.network : defaults.network,
    rpcUrls: strings(r.rpcUrls),
    indexerUrl: typeof r.indexerUrl === "string" ? r.indexerUrl : "",
    sponsorUrls: strings(r.sponsorUrls),
    payment: validPayment,
    autoLockMinutes: autoLock,
    muted: strings(r.muted),
  };
}

export interface SettingsStoreOptions {
  storage?: StringStorage;
  env?: EnvDefaults;
}

export type SettingsStore = UseBoundStore<StoreApi<SettingsState>>;

export function createSettingsStore(options: SettingsStoreOptions = {}): SettingsStore {
  const storage = options.storage ?? safeLocalStorage();
  const defaults = defaultSettings(options.env ?? ENV);
  const load = (): Settings => {
    try {
      const text = storage.getItem(SETTINGS_KEY);
      return text ? sanitize(JSON.parse(text), defaults) : defaults;
    } catch {
      return defaults;
    }
  };
  const persist = (settings: Settings) => {
    try {
      storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // storage unavailable: settings live for the session only
    }
  };
  const pick = (state: SettingsState): Settings => ({
    network: state.network,
    rpcUrls: state.rpcUrls,
    indexerUrl: state.indexerUrl,
    sponsorUrls: state.sponsorUrls,
    payment: state.payment,
    autoLockMinutes: state.autoLockMinutes,
    muted: state.muted,
  });
  return create<SettingsState>()((set, get) => ({
    ...load(),
    update(patch) {
      set(patch);
      persist(pick(get()));
    },
    reset() {
      set(defaults);
      persist(defaults);
    },
  }));
}

export const useSettings: SettingsStore = createSettingsStore();

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
      : `Protocol contracts are not deployed on ${settings.network} yet`;
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

export { parseList };
