/**
 * Data-layer wiring for React: the resolved settings, the IndexerClient and (when deployed) the
 * ProtocolClient, rebuilt whenever Settings change.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ProtocolClient } from "@osp/sdk";
import { resolveSettings, useSettings, type ResolvedSettings, type SettingsStore } from "../stores/settings";
import { IndexerClient } from "./indexer";
import { createProtocolClient } from "./protocol";

export interface Services {
  resolved: ResolvedSettings;
  indexer: IndexerClient;
  protocol?: ProtocolClient;
}

const ServicesContext = createContext<Services | undefined>(undefined);

export interface ServicesProviderProps {
  children: ReactNode;
  store?: SettingsStore;
  /** Test hook: build services from resolved settings. */
  factory?: (resolved: ResolvedSettings) => Services;
}

export function defaultServices(resolved: ResolvedSettings): Services {
  const protocol = createProtocolClient(resolved);
  return { resolved, indexer: new IndexerClient({ baseUrl: resolved.indexerUrl }), ...(protocol && { protocol }) };
}

export function ServicesProvider({ children, store = useSettings, factory = defaultServices }: ServicesProviderProps) {
  const settings = store();
  const key = JSON.stringify([settings.network, settings.rpcUrls, settings.indexerUrl, settings.sponsorUrls, settings.payment]);
  const services = useMemo(() => factory(resolveSettings(settings)), [key, factory]); // eslint-disable-line react-hooks/exhaustive-deps
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const value = useContext(ServicesContext);
  if (!value) throw new Error("useServices must be used inside ServicesProvider");
  return value;
}
