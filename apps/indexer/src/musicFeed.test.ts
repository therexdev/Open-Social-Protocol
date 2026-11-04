import { afterEach, expect, it } from "vitest";
import { encode, toBase64url, identityFromSeed } from "@osp/sdk";
import { IndexerDb } from "./db.js";
import { applyEvent, replayProjections, type LogEvent } from "./projections.js";
import { decodeEventDataFixed } from "./decode.js";
import { timeline } from "./musicFeed.js";
import { backfillMusic } from "./musicProjection.js";
import { decodeCursor, feed } from "./queries.js";
const owner = identityFromSeed(new Uint8Array(32).fill(1)).account, viewer = identityFromSeed(new Uint8Array(32).fill(2)).account;
const id = (n: number) => new Uint8Array(32).fill(n), b64 = (n: number) => toBase64url(id(n));
const databases: IndexerDb[] = [];
function database() { const db = IndexerDb.memory(); databases.push(db); return db; }
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function event(db: IndexerDb, kind: string, data: Record<string, unknown>, height: number, apply = true) {
  const name = `osp.publications.${kind}`, raw = toBase64url(encode(`publications.${kind}_event`, data));
  const e: LogEvent = { height, blockId: `b${height}`, blockTimestamp: String(height * 1000), txIndex: 0, sequence: 0, txId: `tx${height}`, contract: "publications", impacted: [], name, data: decodeEventDataFixed(name, raw)! };
  db.run("INSERT INTO event_log VALUES (?,?,?,?,?,?,?,?,?,?,?)", height, 0, 0, e.blockId, e.blockTimestamp, e.txId, e.contract, name, raw, "{}", "[]");
  if (apply) applyEvent(db, e);
}
function paid(db: IndexerDb, n: number, audience = 0, apply = true) {
  event(db, "music_paid", { id: id(n), value: { owner, audience, group_id: audience === 2 ? id(90) : undefined, digest: id(n + 50), size: 20, chunk_hashes: [id(80)], title: "Song", unlock_price: "500", encrypted: true } }, n, apply);
}
function completed(db: IndexerDb, n: number, height: number, apply = true) { event(db, "music_completed", { id: id(n), owner }, height, apply); }
const tracks = (db: IndexerDb, account?: string, scope: "all" | "friends" | "public" = "all") => timeline(db, { scope, viewer: account, limit: 20 }).items.map(i => i.postId);
it("interleaves completed tracks and posts with stable non-duplicating cursors; keeps v1 unchanged", () => {
  const db = database(); paid(db, 1); paid(db, 2); paid(db, 3); completed(db, 1, 10); completed(db, 2, 12);
  event(db, "published", { author: owner, post_id: id(45), content_hash: id(46), version_number: 1, sequence: "1", audience: 0, envelope: new Uint8Array([1]), protocol_version: 1, timestamp: "11000" }, 11);
  const page = timeline(db, { scope: "public", limit: 2 });
  expect(page.items.map(i => i.postId)).toEqual([`music:${b64(2)}`, b64(45)]);
  expect(page.nextCursor).toBeTruthy();
  const next = timeline(db, { scope: "public", limit: 2, cursor: decodeCursor(page.nextCursor!) });
  expect(next.items.map(i => i.postId)).toEqual([`music:${b64(1)}`]); expect(next.nextCursor).toBeNull();
  expect(feed(db, { scope: "public", limit: 20 }).items.map(i => i.postId)).toEqual([b64(45)]);
  // The paid/public song is discoverable; a partial paid upload is not.
  expect(tracks(db)).not.toContain(`music:${b64(3)}`);
});
it("filters current friends, group membership, closed groups and blocks in both directions", () => {
  const db = database(); for (const n of [1,2,3]) { paid(db, n, n - 1); completed(db, n, n + 10); }
  expect(tracks(db)).toEqual([`music:${b64(1)}`]);
  expect(tracks(db, viewer)).toEqual([`music:${b64(1)}`]);
  db.run("INSERT INTO relationships (a,b,status,requester,nonce,requested_at,since,updated_at) VALUES (?,?,2,?,'1','0','0','0')", owner, viewer, owner);
  db.run("INSERT INTO photo_collections VALUES (?,?,2,2,0,'{}')", b64(90), owner);
  db.run("INSERT INTO collection_members VALUES (?,?)", b64(90), viewer);
  expect(tracks(db, viewer)).toEqual([3,2,1].map(n => `music:${b64(n)}`));
  expect(tracks(db, viewer, "public")).toEqual([`music:${b64(1)}`]);
  db.run("DELETE FROM relationships"); expect(tracks(db, viewer)).toEqual([3,1].map(n => `music:${b64(n)}`));
  db.run("UPDATE photo_collections SET closed=1"); expect(tracks(db, viewer)).toEqual([`music:${b64(1)}`]);
  db.run("UPDATE photo_collections SET closed=0"); db.run("DELETE FROM collection_members"); expect(tracks(db, viewer)).toEqual([`music:${b64(1)}`]);
  for (const pair of [[viewer, owner], [owner, viewer]]) { db.run("INSERT INTO blocks_list VALUES (?,?,'0')", ...pair); expect(tracks(db, viewer)).toEqual([]); db.run("DELETE FROM blocks_list"); }
  expect(tracks(db, owner)).toHaveLength(3);
});
it("backfills retained history once, retains completion order after cover edits, and rebuilds after rollback", () => {
  const db = database(); paid(db, 1, 0, false); completed(db, 1, 10, false); paid(db, 2, 0, false); completed(db, 2, 12, false);
  backfillMusic(db); const before = tracks(db); expect(before).toHaveLength(2);
  backfillMusic(db); expect(tracks(db)).toEqual(before);
  event(db, "music_cover_updated", { id: id(1), owner, cover: { photo_id: id(99), digest: id(98), size: 20, mime: "image/jpeg" }, revision: 1 }, 20);
  expect(tracks(db)).toEqual(before);
  replayProjections(db); expect(tracks(db)).toEqual(before);
  db.run("DELETE FROM event_log WHERE height>=12"); replayProjections(db); expect(tracks(db)).toEqual([`music:${b64(1)}`]);
});
