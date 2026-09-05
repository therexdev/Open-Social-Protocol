/** React access to the vault store, injectable for tests (`<VaultProvider store={...}>`). */
import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";
import { useVault as defaultVault, type VaultState, type VaultStore } from "./store";

const VaultContext = createContext<VaultStore>(defaultVault);

export function VaultProvider({ store, children }: { store: VaultStore; children: ReactNode }) {
  return <VaultContext.Provider value={store}>{children}</VaultContext.Provider>;
}

export function useVaultStore(): VaultStore {
  return useContext(VaultContext);
}

export function useVault(): VaultState;
export function useVault<T>(selector: (state: VaultState) => T): T;
export function useVault<T>(selector?: (state: VaultState) => T): T | VaultState {
  const store = useVaultStore();
  const select = (selector ?? ((s: VaultState) => s)) as (state: VaultState) => T | VaultState;
  return useStore(store, select);
}
