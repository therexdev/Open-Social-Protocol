import type { IndexerDb } from "./db.js";
import { feed, encodeCursor, type FeedQuery, type PositionCursor, type PostView, type Page } from "./queries.js";

export interface MusicFeedView {
  kind: "music"; trackId: string; postId: string; author: string; audience: number;
  contentHash: string; state: number; createdAt: string; blockHeight: string;
  groupId: string; promoted?: undefined;
}
interface MusicRow { id: string; owner: string; audience: number; digest: string; group_id: string; created_at: string; block_height: number; tx_index: number; event_sequence: number }

export function timeline(db: IndexerDb, query: FeedQuery): Page<PostView | MusicFeedView> {
  const posts = feed(db, { ...query, limit: query.limit + 1 });
  const conditions = ["m.complete=1"], params: Array<string | number> = [];
  const viewer = query.viewer;
  const friends = `EXISTS (SELECT 1 FROM relationships r WHERE r.status=2 AND ((r.a=m.owner AND r.b=?) OR (r.b=m.owner AND r.a=?)))`;
  if (!viewer) conditions.push("m.audience=0");
  else {
    conditions.push(`(m.owner=? OR m.audience=0 OR (m.audience=1 AND ${friends}) OR (m.audience=2 AND EXISTS
      (SELECT 1 FROM photo_collections c JOIN collection_members cm ON cm.id=c.id WHERE c.id=m.group_id AND c.kind=2 AND c.closed=0 AND cm.account=?)))`);
    params.push(viewer, viewer, viewer, viewer);
    conditions.push(`NOT EXISTS (SELECT 1 FROM blocks_list b WHERE (b.actor=? AND b.target=m.owner) OR (b.actor=m.owner AND b.target=?))`);
    params.push(viewer, viewer);
  }
  if (query.scope === "public") conditions.push("m.audience=0");
  if (query.scope === "friends") {
    conditions.push(viewer ? `(m.owner=? OR ${friends})` : "0");
    if (viewer) params.push(viewer, viewer, viewer);
  }
  if (query.cursor) { conditions.push("(m.block_height,m.tx_index,m.event_sequence)<(?,?,?)"); params.push(...query.cursor); }
  const tracks = db.all<MusicRow>(`SELECT m.* FROM music_tracks m WHERE ${conditions.join(" AND ")}
    ORDER BY m.block_height DESC,m.tx_index DESC,m.event_sequence DESC LIMIT ?`, ...params, query.limit + 1);
  const entries: Array<{ item: PostView | MusicFeedView; position: PositionCursor }> = posts.items.map(item => {
    const p = db.get<{ block_height: number; tx_index: number; event_sequence: number }>("SELECT block_height,tx_index,event_sequence FROM posts WHERE post_id=?", item.postId)!;
    return { item, position: [p.block_height, p.tx_index, p.event_sequence] };
  });
  for (const m of tracks) entries.push({ item: {
    kind: "music", trackId: m.id, postId: `music:${m.id}`, author: m.owner, audience: m.audience, contentHash: m.digest,
    state: 0, groupId: m.group_id, createdAt: m.created_at, blockHeight: String(m.block_height),
  }, position: [m.block_height, m.tx_index, m.event_sequence] });
  entries.sort((a, b) => b.position[0] - a.position[0] || b.position[1] - a.position[1] || b.position[2] - a.position[2]);
  const page = entries.slice(0, query.limit), last = page[page.length - 1];
  return { items: page.map(entry => entry.item), nextCursor: entries.length > query.limit && last ? encodeCursor(last.position) : null };
}
