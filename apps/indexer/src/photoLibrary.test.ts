import { it, expect } from "vitest";
import { encode, toBase64url, identityFromSeed } from "@osp/sdk";
import { IndexerDb } from "./db.js";
import { applyEvent, type LogEvent } from "./projections.js";
import { decodeEventDataFixed } from "./decode.js";
const id = new Uint8Array(32).fill(61),
  owner = identityFromSeed(new Uint8Array(32).fill(1)).account,
  peer = identityFromSeed(new Uint8Array(32).fill(2)).account;
function event(kind: string, data: Record<string, unknown>): LogEvent {
  const name = `osp.publications.${kind}`;
  return {
    height: 10,
    blockId: "b",
    blockTimestamp: "1000",
    txIndex: 0,
    sequence: 0,
    txId: "tx",
    contract: "publications",
    impacted: [],
    name,
    data: decodeEventDataFixed(
      name,
      encode(`publications.${kind}_event`, data)
    )!,
  };
}
it("rebuilds archive chunks idempotently and removes revoked members from the current directory", () => {
  const db = IndexerDb.memory(),
    collection = {
      owner,
      kind: 1,
      audience: 2,
      revision: 1,
      members: [peer],
      envelope: new Uint8Array([1]),
      closed: false,
    };
  const first = event("collection_changed", { id, value: collection });
  applyEvent(db, first);
  expect(db.all("SELECT * FROM collection_members")).toHaveLength(2);
  applyEvent(
    db,
    event("collection_changed", {
      id,
      value: { ...collection, revision: 2, members: [] },
    })
  );
  expect(db.all("SELECT * FROM collection_members")).toHaveLength(1);
  expect(
    db.get<{ account: string }>("SELECT account FROM collection_members")!
      .account
  ).toBe(owner);
  const chunk = event("photo_chunk", {
    id,
    index: 0,
    data: new Uint8Array([7, 8]),
  });
  applyEvent(db, chunk);
  applyEvent(db, chunk);
  expect(db.all("SELECT * FROM photo_chunks")).toHaveLength(1);
  expect(
    db.get<{ data: Uint8Array }>(
      "SELECT data FROM photo_chunks WHERE id=?",
      toBase64url(id)
    )!.data
  ).toEqual(new Uint8Array([7, 8]));
  const item = event("album_item_changed", {
    collection_id: id,
    id,
    value: {
      envelope: new Uint8Array([3]),
      epoch: 1,
      revision: 1,
      removed: false,
    },
  });
  applyEvent(db, item);
  applyEvent(
    db,
    event("album_item_changed", {
      collection_id: id,
      id,
      value: { epoch: 2, revision: 2, removed: true },
    })
  );
  expect(
    db.get<{ removed: number }>("SELECT removed FROM album_items")!.removed
  ).toBe(1);
  db.close();
});
