/** Cache of indexer profiles (names, encryption keys) keyed by account. */
import { create } from "zustand";
import type { IndexerClient, ProfileView } from "../api/indexer";
import { profileInfo, type ProfileInfo } from "../api/profiles";
import { shortAddress } from "../util/format";

interface ProfilesState {
  profiles: Record<string, ProfileView | null>;
  pending: Record<string, true>;
  fetchedAt: Record<string, number>;
  load(indexer: IndexerClient, account: string, force?: boolean): Promise<ProfileView | undefined>;
  set(account: string, view: ProfileView | null): void;
}

export const useProfiles = create<ProfilesState>()((set, get) => ({
  profiles: {},
  pending: {},
  fetchedAt: {},
  async load(indexer, account, force = false) {
    const state = get();
    const age = Date.now() - (state.fetchedAt[account] ?? 0);
    if (!force && account in state.profiles && age < 60_000) return state.profiles[account] ?? undefined;
    if (state.pending[account]) return state.profiles[account] ?? undefined;
    set((s) => ({ pending: { ...s.pending, [account]: true } }));
    try {
      const view = await indexer.profile(account);
      set((s) => ({
        profiles: { ...s.profiles, [account]: view ?? null },
        fetchedAt: { ...s.fetchedAt, [account]: Date.now() },
      }));
      return view;
    } catch {
      set((s) => ({ fetchedAt: { ...s.fetchedAt, [account]: Date.now() } }));
      return undefined;
    } finally {
      set((s) => {
        const { [account]: _done, ...pending } = s.pending;
        return { pending };
      });
    }
  },
  set(account, view) {
    set((s) => ({ profiles: { ...s.profiles, [account]: view }, fetchedAt: { ...s.fetchedAt, [account]: Date.now() } }));
  },
}));

export function infoFor(account: string, view: ProfileView | null | undefined): ProfileInfo {
  return profileInfo(account, view ?? undefined);
}

export function displayNameOf(account: string, view: ProfileView | null | undefined): string {
  const info = infoFor(account, view);
  return info.displayName || shortAddress(account);
}
