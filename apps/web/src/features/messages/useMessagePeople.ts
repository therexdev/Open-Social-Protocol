import { useEffect } from "react";
import { useServices } from "../../api/services";
import { displayNameOf, useProfiles } from "../../stores/profiles";
import { useGraph } from "../friends/RelationshipActions";

/** Resolve friends and existing chats through the shared public-profile cache. */
export function useMessagePeople(account: string | undefined, peers: string[]) {
  const { indexer } = useServices();
  const { graph, loading, error, refresh } = useGraph(account);
  const profiles = useProfiles(s => s.profiles);
  const load = useProfiles(s => s.load);
  const friends = (graph?.friends ?? []).map(f => f.account)
    .filter(peer => peer !== account && !graph?.blocked.includes(peer));
  const accountsKey = JSON.stringify([...new Set([...friends, ...peers])].sort());

  useEffect(() => {
    if (!account || !indexer.configured) return;
    let cancelled = false;
    const queue = JSON.parse(accountsKey) as string[];
    // Large friend lists must not launch hundreds of simultaneous requests.
    const worker = async () => {
      while (!cancelled && queue.length) {
        const peer = queue.shift()!;
        await load(indexer, peer);
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    return () => { cancelled = true; };
  }, [account, accountsKey, indexer, load]);

  return {
    graph, friends, blocked: graph?.blocked ?? [], loading, error, refresh,
    name: (peer: string) => displayNameOf(peer, profiles[peer]),
  };
}
