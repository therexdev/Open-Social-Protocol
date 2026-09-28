import { describe, expect, it } from "vitest";
import { identityFromSeed } from "@osp/sdk";
import {
  IndexerDb,
  KoinosChain,
  createIndexer,
  loadConfig,
  replayProjections,
} from "./index.js";
import {
  ChainBuilder,
  FakeProvider,
  testDeployment,
  ospEvent,
  tx,
} from "./testing/fake-chain.js";
const a = identityFromSeed(new Uint8Array(32).fill(71)).account,
  b = identityFromSeed(new Uint8Array(32).fill(72)).account;
describe("private transport indexing", () => {
  it("separates the recipient-free invitation log, paginates aliases exactly, and replays deterministically", async () => {
    const deployment = testDeployment(),
      builder = new ChainBuilder(deployment);
    const packet = (n: number, peer: string) =>
      ospEvent(
        deployment,
        "osp.messaging.private_packet",
        {
          value: {
            actor: a,
            peer,
            packet_id: new Uint8Array(32).fill(n),
            content_hash: new Uint8Array(32),
            sequence: String(9007199254740990n + BigInt(n)),
            timestamp: "100",
            block: "1",
          },
          envelope: new Uint8Array([1, 2, 3]),
        },
        peer ? [a, peer] : [a],
      );
    builder.block([tx([packet(1, ""), packet(2, b), packet(3, "")])]);
    const config = loadConfig(
        { OSP_NETWORK: "test", OSP_INDEXER_DB: ":memory:" },
        { deployment },
      ),
      indexer = createIndexer({
        config,
        db: IndexerDb.memory(),
        chain: new KoinosChain(new FakeProvider(builder), deployment),
      });
    try {
      await indexer.syncer!.syncToHead();
      const update = await indexer.api.inject({ method: "GET", url: "/v2/private/updates" });
      expect(update.statusCode).toBe(200);
      expect(update.json().cursor).toMatch(/^[a-f0-9]{64}$/);
      expect(update.headers["cache-control"]).toBe("no-store");
      expect((await indexer.api.inject({ method: "GET", url: "/v2/private/updates?cursor=bad" })).statusCode).toBe(400);
      const waiting = indexer.api.inject({ method: "GET", url: `/v2/private/updates?cursor=${update.json().cursor}` }).then(response => response);
      await new Promise(resolve => setImmediate(resolve));
      builder.block([]);
      await indexer.syncer!.syncToHead();
      expect((await waiting).json().cursor).not.toBe(update.json().cursor);
      const first = await indexer.api.inject({
        method: "GET",
        url: "/v2/private/packets?limit=1",
      });
      expect(first.statusCode).toBe(200);
      expect(first.headers["cache-control"]).toBe("no-store");
      expect(first.json().items).toHaveLength(1);
      expect(first.json().items[0].peer).toBe("");
      expect(first.json().more).toBe(true);
      const next = await indexer.api.inject({
        method: "GET",
        url: "/v2/private/packets?after=9007199254740991",
      });
      expect(next.json().items.map((i: any) => i.sequence)).toEqual([
        "9007199254740993",
      ]);
      const channel = await indexer.api.inject({
        method: "GET",
        url: `/v2/private/packets?actor=${a}&peer=${b}`,
      });
      expect(channel.json().items.map((i: any) => i.sequence)).toEqual([
        "9007199254740992",
      ]);
      replayProjections(indexer.db);
      expect(
        (
          await indexer.api.inject({
            method: "GET",
            url: "/v2/private/packets?limit=1",
          })
        ).body,
      ).toBe(first.body);
      expect(
        (
          await indexer.api.inject({
            method: "GET",
            url: `/v2/private/packets?actor=${a}`,
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await indexer.close();
    }
  });
});
