import { musicEngagementId, toBase64url, identityFromSeed } from "@osp/sdk";
import { expect, it } from "vitest";
import { IndexerDb, KoinosChain, createIndexer, loadConfig, replayProjections } from "./index.js";
import { ChainBuilder, FakeProvider, ospEvent, testDeployment, tx } from "./testing/fake-chain.js";

it("pages closed post and media rewards at the closing block and restores eligibility after a fork", async () => {
  const deployment = testDeployment();
  const chain = new ChainBuilder(deployment);
  const provider = new FakeProvider(chain);
  const db = IndexerDb.memory();
  const indexer = createIndexer({
    db, chain: new KoinosChain(provider, deployment),
    config: loadConfig({ OSP_NETWORK: "test" }, { deployment }),
  });
  const author = identityFromSeed(new Uint8Array(32).fill(1)).account;
  const voter = identityFromSeed(new Uint8Array(32).fill(2)).account;
  const digest = new Uint8Array(32).fill(3);
  const song = musicEngagementId(digest);
  const comment = musicEngagementId(digest, new Uint8Array(32).fill(4));
  const post = new Uint8Array(32).fill(5);
  const future = new Uint8Array(32).fill(6);
  const rewardEvent = (id: Uint8Array, settled = false, epochId = "1") => {
    const value = { post_id: id, version: digest, author, epoch: epochId, score: "0", reward: "0", settled };
    const epoch = { id: epochId, end_block: epochId === "1" ? "101" : "102" };
    const data = { value, epoch, actor: voter };
    return settled
      ? ospEvent(deployment, "osp.token.reward_settled", data, [author, voter])
      : ospEvent(deployment, "osp.token.voted", { ...data, vote: { direction: 2, weight: "1" } }, [voter, author]);
  };
  const route = "/v1/token/settlements/due";
  const list = async (suffix = "") => {
    const result = await indexer.api.inject({ method: "GET", url: route + suffix });
    expect(result.statusCode).toBe(200);
    return result.json<{ items: string[]; nextCursor: string | null }>();
  };
  try {
    chain.blockWith(rewardEvent(post), rewardEvent(song), rewardEvent(comment));
    await indexer.syncer!.syncToHead();
    expect((await list()).items).toEqual([]);

    chain.block([tx([rewardEvent(future, false, "2")]), tx([rewardEvent(post, true)], { reverted: true })]);
    await indexer.syncer!.syncToHead();
    const expected = [song, comment, post].map(toBase64url).sort();
    const first = await list("?limit=2");
    expect(first.items).toEqual(expected.slice(0, 2));
    expect(first.nextCursor).toBeTruthy();
    expect(await list("?limit=2&cursor=" + encodeURIComponent(first.nextCursor!))).toEqual({
      items: expected.slice(2), nextCursor: null,
    });
    expect((await indexer.api.inject({ method: "GET", url: route + "?cursor=wrong" })).statusCode).toBe(400);
    expect((await indexer.api.inject({ method: "GET", url: route + "?limit=0" })).statusCode).toBe(400);

    chain.blockWith(rewardEvent(song, true));
    await indexer.syncer!.syncToHead();
    const beforeFork = await list();
    expect(beforeFork.items).toEqual([...expected.filter(item => item !== toBase64url(song)), toBase64url(future)]);
    replayProjections(db);
    expect(await list()).toEqual(beforeFork);

    const fork = chain.fork(102);
    fork.blockWith(rewardEvent(post, true));
    provider.use(fork, 100);
    await indexer.syncer!.syncToHead();
    expect((await list()).items).toEqual([...expected.filter(item => item !== toBase64url(post)), toBase64url(future)]);
  } finally {
    await indexer.close();
  }
});
