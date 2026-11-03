import { describe, it, expect } from "vitest";
import { encode, toBase64url } from "@osp/sdk";
import { IndexerDb } from "./db.js";
import { applyEvent, type LogEvent } from "./projections.js";
import { decodeEventDataFixed } from "./decode.js";

const id = new Uint8Array(32).fill(17);
const base = { height: 100, blockId: "block", blockTimestamp: "1000", txIndex: 0, sequence: 0, txId: "tx", contract: "publications", impacted: [] } as const;
const poll = { definition: { question: "Choose?", options: ["A", "B"], closes_at: "99999" }, counts: [1, 0], participants: 1, engagement_participants: 1, engagement_milli: "250" };
function event(kind: "poll_created" | "poll_answered", data: Record<string, unknown>): LogEvent {
  const name = `osp.publications.${kind}`;
  return { ...base, impacted: [], name, data: decodeEventDataFixed(name, encode(`publications.${kind}_event`, data))! };
}
describe("poll projections", () => {
  it("round trips zero choices, changes answers, and replays without doubling totals", () => {
    const db = IndexerDb.memory();
    const events = [event("poll_created", { post_id: id, poll: { ...poll, counts: [0, 0], participants: 0 } }),
      event("poll_answered", { post_id: id, actor: "1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe", ballot: { option: 0 }, poll }),
      event("poll_answered", { post_id: id, actor: "1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe", ballot: { option: 1 }, poll: { ...poll, counts: [0, 1] } })];
    // Address fields require actual addresses when encoded.
    for (const e of events) applyEvent(db, e);
    for (const e of events) applyEvent(db, e);
    const row = db.get<{ data_json: string }>("SELECT data_json FROM polls WHERE post_id=?", toBase64url(id))!;
    expect(JSON.parse(row.data_json)).toMatchObject({ participants: 1, counts: [0, 1], engagement_milli: "250" });
    expect(db.all("SELECT * FROM poll_ballots")).toHaveLength(1);
    expect(db.get<{ option: number }>("SELECT option FROM poll_ballots")!.option).toBe(1);
    db.close();
  });
});
