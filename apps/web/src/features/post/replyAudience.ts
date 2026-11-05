import { RELATIONSHIP_STATUS, type ProtocolClient } from "@osp/sdk";
import type { IndexerClient } from "../../api/indexer";

/** The author's friends are the readers of a friends-only thread. The indexer
 * proposes addresses; the chain decides who can receive a key for this reply. */
export async function threadFriends(client: ProtocolClient, indexer: Pick<IndexerClient, "graph">, author: string, me: string) {
  const epoch = (await client.reads.relationships.get_audience({ account: author }))?.value?.epoch;
  if (epoch === undefined) throw Error("Could not verify the thread's audience.");
  const isFriend = async (b: string) =>
    (await client.reads.relationships.get_relationship({ a: author, b }))?.value?.status === RELATIONSHIP_STATUS.ACTIVE;
  if (me !== author && !await isFriend(me)) throw Error("Only current friends of the post author can reply.");
  const graph = await indexer.graph(author);
  const candidates = [...new Set(graph.friends.map(f => f.account))].filter(a => a !== author && a !== me);
  const selected = me === author ? [] : [author];
  for (let i = 0; i < candidates.length; i += 6) {
    const group = candidates.slice(i, i + 6);
    const active = await Promise.all(group.map(isFriend));
    selected.push(...group.filter((_, j) => active[j]));
    if (selected.length > 50) throw Error("This thread exceeds the current 50-recipient limit for encrypted replies.");
  }
  return { selected, epoch };
}
