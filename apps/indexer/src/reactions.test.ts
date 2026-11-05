import { expect, it } from "vitest";
import { encode, identityFromSeed, musicEngagementId, toBase64url } from "@osp/sdk";
import { buildApi } from "./api.js";
import { loadConfig } from "./config.js";
import { IndexerDb } from "./db.js";
import { decodeEventDataFixed } from "./decode.js";
import { applyEvent } from "./projections.js";
import { reactionSummary } from "./queries.js";
import { testDeployment } from "./testing/fake-chain.js";

it("replaces historical choices, keeps other voters and post IDs separate, and serves a padded music ID", async () => {
  const db = IndexerDb.memory(), app = buildApi({ db, config: loadConfig({}, { deployment: testDeployment() }) });
  const id = new Uint8Array(32).fill(81), target = musicEngagementId(id);
  const viewer = identityFromSeed(new Uint8Array(32).fill(1)).account;
  const other = identityFromSeed(new Uint8Array(32).fill(2)).account;
  let height = 0;
  const react = (key: Uint8Array, actor: string, code: number, exclusive?: boolean, removed = false) => {
    height++;
    const raw = encode("publications.reaction_event", { post_id: key, actor, post_author: other, reaction: code, exclusive, removed, timestamp: String(height) });
    const name = "osp.publications.reaction";
    applyEvent(db, { height, blockId: String(height), blockTimestamp: String(height), txIndex: 0, sequence: 0, txId: String(height),
      contract: "publications", impacted: [], name, data: decodeEventDataFixed(name, raw)! });
  };
  try {
    react(target, viewer, 1); react(target, viewer, 2);
    react(target, other, 4, true); react(id, viewer, 2, true);
    react(target, viewer, 3, true); react(target, viewer, 3, true);
    const url = `/v1/music/${encodeURIComponent(toBase64url(id))}/engagement?viewer=${viewer}`;
    const commentId = new Uint8Array(32).fill(19), commentKey = musicEngagementId(id, commentId);
    react(commentKey, viewer, 5, true); react(commentKey, viewer, 2, true);
    expect((await app.inject(`${url}&comment=${encodeURIComponent(toBase64url(commentId))}`)).json().reactions).toEqual({ total: 1, byType: { "2": 1 }, viewer: [2] });
    expect((await app.inject(`${url}&comment=A`)).statusCode).toBe(400);
    const response = await app.inject(url);
    expect(response.statusCode).toBe(200);
    expect(response.json().reactions).toEqual({ total: 2, byType: { "3": 1, "4": 1 }, viewer: [3] });
    react(target, viewer, 3, true, true);
    expect((await app.inject(url)).json().reactions).toEqual({ total: 1, byType: { "4": 1 }, viewer: [] });
    expect(reactionSummary(db, toBase64url(id), viewer)).toEqual({ total: 1, byType: { "2": 1 }, viewer: [2] });
  } finally { await app.close(); db.close(); }
});
