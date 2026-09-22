import { describe, it, expect } from "vitest";
import { identityFromSeed } from "@osp/sdk";
import { IndexerDb, KoinosChain, createIndexer, loadConfig, replayProjections } from "./index.js";
import { ChainBuilder, FakeProvider, testDeployment, ospEvent, tx } from "./testing/fake-chain.js";
const alice = identityFromSeed(new Uint8Array(32).fill(21)),
  bob = identityFromSeed(new Uint8Array(32).fill(22));
describe("V1 message and token projections", () => {
  it("replays private ciphertext and token activity without changing query results", async () => {
    const deployment = testDeployment(),
      builder = new ChainBuilder(deployment),
      when = String(builder.baseTimestamp);
    const conversation = {
      a: alice.account,
      b: bob.account,
      requester: alice.account,
      status: 2,
      generation: "1",
      sequence: "0",
      updated_at: when,
    };
    const message = {
      sender: alice.account,
      recipient: bob.account,
      message_id: new Uint8Array(32).fill(1),
      content_hash: new Uint8Array(32).fill(2),
      generation: "1",
      sequence: "9007199254740993",
      timestamp: when,
    };
    builder.block([
      tx([
        ospEvent(deployment, "osp.messaging.conversation_changed", { value: conversation, timestamp: when }, [alice.account, bob.account]),
        ospEvent(deployment, "osp.messaging.message_sent", { value: message, envelope: new Uint8Array([1, 2, 3]), timestamp: when }, [
          alice.account,
          bob.account,
        ]),
        ospEvent(
          deployment,
          "osp.token.account_updated",
          {
            account: bob.account,
            value: { balance: "1", free_credits: "100000", token_credits: "1000", updated_at: when },
            timestamp: when,
          },
          [bob.account]
        ),
        ospEvent(
          deployment,
          "osp.token.supported",
          { actor: alice.account, recipient: bob.account, post_id: new Uint8Array(32).fill(3), reward: "1", timestamp: when },
          [alice.account, bob.account]
        ),
      ]),
    ]);
    const config = loadConfig({ OSP_NETWORK: "test", OSP_INDEXER_DB: ":memory:" }, { deployment });
    const indexer = createIndexer({ config, db: IndexerDb.memory(), chain: new KoinosChain(new FakeProvider(builder), deployment) });
    try {
      await indexer.syncer!.syncToHead();
      const paths = [
        `/v1/conversations/${bob.account}`,
        `/v1/messages/${bob.account}/${alice.account}`,
        `/v1/token/${bob.account}/activity`,
      ];
      const before = await Promise.all(paths.map((url) => indexer.api.inject({ method: "GET", url })));
      expect(before.every((r) => r.statusCode === 200)).toBe(true);
      expect(before[1]!.json().items[0]).toMatchObject({ envelope: "AQID", sequence: "9007199254740993" });
      expect(before[2]!.json().items[0]).toMatchObject({ reward: "1", recipient: bob.account });
      replayProjections(indexer.db);
      for (let i = 0; i < paths.length; i++)
        expect((await indexer.api.inject({ method: "GET", url: paths[i]! })).body).toBe(before[i]!.body);
      const invalid = await indexer.api.inject({ method: "GET", url: `/v1/messages/${bob.account}/${alice.account}?before=x` });
      expect(invalid.statusCode).toBe(400);
    } finally {
      await indexer.close();
    }
  });
});
