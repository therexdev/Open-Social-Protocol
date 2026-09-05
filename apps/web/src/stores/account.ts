/** Registration state of the signed-in account (chain first, indexer as a fallback). */
import { create } from "zustand";
import type { IdentityRecord } from "@osp/sdk";
import type { Services } from "../api/services";

export type Registration = "unknown" | "checking" | "registered" | "unregistered" | "unavailable";

interface AccountState {
  account?: string;
  registration: Registration;
  record?: IdentityRecord;
  checkedAt?: number;
  check(services: Services, account: string, force?: boolean): Promise<Registration>;
  markRegistered(account: string, record?: IdentityRecord): void;
  reset(): void;
}

export const useAccount = create<AccountState>()((set, get) => ({
  registration: "unknown",
  async check(services, account, force = false) {
    const state = get();
    if (!force && state.account === account && state.registration === "registered") return state.registration;
    if (state.account === account && state.registration === "checking") return state.registration;
    set({ account, registration: "checking" });
    let result: Registration = "unavailable";
    let record: IdentityRecord | undefined;
    if (services.protocol) {
      try {
        const response = await services.protocol.reads.identity.get_identity({ account });
        record = response?.value;
        result = record ? "registered" : "unregistered";
      } catch {
        result = "unavailable";
      }
    }
    if (result === "unavailable" && services.indexer.configured) {
      try {
        const profile = await services.indexer.profile(account);
        result = profile ? "registered" : services.protocol ? "unregistered" : "unavailable";
      } catch {
        // keep unavailable
      }
    }
    if (get().account !== account) return get().registration;
    set({ registration: result, record, checkedAt: Date.now() });
    return result;
  },
  markRegistered(account, record) {
    set({ account, registration: "registered", record, checkedAt: Date.now() });
  },
  reset() {
    set({ account: undefined, registration: "unknown", record: undefined, checkedAt: undefined });
  },
}));
