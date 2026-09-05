import { useEffect } from "react";
import { useServices } from "../../api/services";
import { displayNameOf, infoFor, useProfiles } from "../../stores/profiles";
import type { ProfileInfo } from "../../api/profiles";

export function useProfileInfo(account: string | undefined): ProfileInfo | undefined {
  const { indexer } = useServices();
  const view = useProfiles((s) => (account ? s.profiles[account] : undefined));
  const load = useProfiles((s) => s.load);
  useEffect(() => {
    if (account && indexer.configured) void load(indexer, account);
  }, [account, indexer, load]);
  return account ? infoFor(account, view) : undefined;
}

export function useProfileName(account: string): string {
  const { indexer } = useServices();
  const view = useProfiles((s) => s.profiles[account]);
  const load = useProfiles((s) => s.load);
  useEffect(() => {
    if (indexer.configured) void load(indexer, account);
  }, [account, indexer, load]);
  return displayNameOf(account, view);
}
