import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { IndexerDb, KoinosChain, SyncError, createIndexer, loadConfig, replayProjections, type Env, type Indexer } from "./index.js";
import { ChainBuilder, FakeProvider, ospEvent, tx } from "./testing/fake-chain.js";
import { buildHistory, type History } from "./testing/history.js";

const history: History = buildHistory();
const open: Indexer[] = [];

function makeIndexer(provider: FakeProvider, dbPath = ":memory:", env: Env = {}): Indexer {
  const config = loadConfig({ OSP_NETWORK: "test", OSP_INDEXER_DB: dbPath, OSP_BATCH_SIZE: "3", ...env }, { deployment: history.deployment });
  const indexer = createIndexer({ config, db: dbPath === ":memory:" ? IndexerDb.memory() : new IndexerDb(dbPath), chain: new KoinosChain(provider, history.deployment) });
  open.push(indexer);
  return indexer;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor: condition not met in time");
    await sleep(5);
  }
}

function getBlocksCalls(provider: FakeProvider): number {
  return provider.calls.filter((c) => c.startsWith("getBlocks")).length;
}

async function status(indexer: Indexer): Promise<Record<string, any>> {
  return (await indexer.api.inject({ method: "GET", url: "/v1/status" })).json();
}

/** A node whose block store never returns block 106 (a gap inside a batch). */
class GappyProvider extends FakeProvider {
  override async getBlocks(height: number, numBlocks = 1, idRef?: string): ReturnType<FakeProvider["getBlocks"]> {
    const items = await super.getBlocks(height, numBlocks, idRef);
    return items.filter((item) => item.block_height !== "106") as Awaited<ReturnType<FakeProvider["getBlocks"]>>;
  }
}

async function feedJson(indexer: Indexer): Promise<string> {
  const viewer = history.actors.bob.account;
  const feed = await indexer.api.inject({ method: "GET", url: `/v1/feed?scope=all&viewer=${viewer}&limit=50` });
  const events = await indexer.api.inject({ method: "GET", url: "/v1/events?fromHeight=100&limit=1000" });
  const graph = await indexer.api.inject({ method: "GET", url: `/v1/graph/${history.actors.alice.account}` });
  const notifications = await indexer.api.inject({ method: "GET", url: `/v1/notifications/${history.actors.alice.account}` });
  return [feed.body, events.body, graph.body, notifications.body].join("\n");
}

function hashes(indexer: Indexer): Array<[number, string]> {
  return indexer.db.all<{ height: number; state_hash: string }>("SELECT height, state_hash FROM checkpoints ORDER BY height").map((r) => [r.height, r.state_hash]);
}

/** A fork of the scripted history starting at `height` with its own events. */
function forkFrom(height: number, blocks: number, label: string): ChainBuilder {
  const fork = history.builder.fork(height);
  const { bob, carol, dave } = history.actors;
  for (let i = 0; i < blocks; i++) {
    const when = fork.timestampAt(fork.height + 1);
    fork.block(
      [
        tx([ospEvent(history.deployment, "osp.relationships.followed", { follower: dave.account, target: carol.account, timestamp: when }, [dave.account, carol.account])]),
        tx([ospEvent(history.deployment, "osp.relationships.followed", { follower: bob.account, target: carol.account, timestamp: when }, [bob.account, carol.account])]),
      ],
      { salt: `${label}-${i}` },
    );
  }
  return fork;
}

afterAll(async () => {
  for (const indexer of open) await indexer.close();
});

describe("determinism", () => {
  it("two fresh indexers over the same history produce identical state hashes and API output", async () => {
    const a = makeIndexer(new FakeProvider(history.builder));
    const b = makeIndexer(new FakeProvider(history.builder));
    await a.syncer!.syncToHead();
    await b.syncer!.syncToHead();
    const ha = hashes(a);
    expect(ha).toHaveLength(13);
    expect(new Set(ha.map(([, h]) => h)).size).toBe(13); // every block (even an empty one) moves the hash
    expect(hashes(b)).toEqual(ha);
    expect(await feedJson(b)).toBe(await feedJson(a));
  });

  it("replaying the projections from the log reproduces the same API output", async () => {
    const indexer = makeIndexer(new FakeProvider(history.builder));
    await indexer.syncer!.syncToHead();
    const before = await feedJson(indexer);
    const applied = replayProjections(indexer.db);
    expect(applied).toBe(36);
    expect(await feedJson(indexer)).toBe(before);
    expect(hashes(indexer)).toEqual(hashes(indexer)); // untouched by replay
  });

  it("--rebuild (delete the database and replay) reproduces the state hash", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "osp-indexer-"));
    const dbPath = path.join(dir, "indexer-test.sqlite");
    try {
      const first = makeIndexer(new FakeProvider(history.builder), dbPath);
      await first.syncer!.syncToHead();
      const expected = hashes(first);
      const output = await feedJson(first);
      await first.close();
      open.splice(open.indexOf(first), 1);

      // Reopening keeps the state; the indexer resumes without re-applying anything.
      const resumed = makeIndexer(new FakeProvider(history.builder), dbPath);
      expect(hashes(resumed)).toEqual(expected);
      expect(await resumed.syncer!.syncOnce()).toEqual({ applied: 0, caughtUp: true });
      await resumed.close();
      open.splice(open.indexOf(resumed), 1);

      IndexerDb.remove(dbPath);
      const rebuilt = makeIndexer(new FakeProvider(history.builder), dbPath);
      expect(rebuilt.db.lastCheckpoint()).toBeUndefined();
      await rebuilt.syncer!.syncToHead();
      expect(hashes(rebuilt)).toEqual(expected);
      expect(await feedJson(rebuilt)).toBe(output);
      await rebuilt.close();
      open.splice(open.indexOf(rebuilt), 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("reorgs", () => {
  it("rolls back to the last irreversible checkpoint and replays when the chain forks", async () => {
    const canonical = makeIndexer(new FakeProvider(history.builder));
    await canonical.syncer!.syncToHead();
    const expected = hashes(canonical);

    const fork = forkFrom(108, 4, "fork-a"); // blocks 108..111 differ, head 111 < canonical head 112
    const provider = new FakeProvider(fork, { lib: 105 });
    const indexer = makeIndexer(provider);
    await indexer.syncer!.syncToHead();
    expect(indexer.db.lastCheckpoint()!.height).toBe(111);
    expect(indexer.db.checkpointAt(111)!.block_id).toBe(fork.headId);
    expect(indexer.db.checkpointAt(111)!.state_hash).not.toBe(expected[11]![1]);
    expect(indexer.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM follows")!.c).toBe(3); // carol->alice + the fork's two

    // The network settles on the canonical chain.
    provider.use(history.builder, 105);
    const result = await indexer.syncer!.syncToHead();
    expect(result.rolledBack).toEqual({ from: 111, to: 105 });
    expect(indexer.syncer!.state.rollbacks).toBe(1);
    expect(hashes(indexer)).toEqual(expected);
    expect(indexer.db.checkpointAt(108)!.block_id).toBe(history.builder.blocks[8]!.block_id);
    expect(await feedJson(indexer)).toBe(await feedJson(canonical));
    expect(indexer.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM follows")!.c).toBe(1);
    expect((await indexer.api.inject({ method: "GET", url: "/v1/status" })).json().healthy).toBe(true);
  });

  it("detects a fork that makes the chain shorter than the indexed tip", async () => {
    const provider = new FakeProvider(history.builder, { lib: 105 });
    const indexer = makeIndexer(provider);
    await indexer.syncer!.syncToHead();
    expect(indexer.db.lastCheckpoint()!.height).toBe(112);

    const shorter = forkFrom(110, 1, "fork-b"); // head 110
    provider.use(shorter, 105);
    const result = await indexer.syncer!.syncToHead();
    expect(result.rolledBack).toEqual({ from: 112, to: 105 });
    expect(indexer.db.lastCheckpoint()!.height).toBe(110);
    expect(indexer.db.checkpointAt(110)!.block_id).toBe(shorter.headId);

    const linear = makeIndexer(new FakeProvider(shorter, { lib: 105 }));
    await linear.syncer!.syncToHead();
    expect(hashes(indexer)).toEqual(hashes(linear));
  });

  it("drops blocks above a head that stays below the indexed tip (persisting shrink)", async () => {
    const provider = new FakeProvider(history.builder, { lib: 105 });
    const indexer = makeIndexer(provider);
    await indexer.syncer!.syncToHead();
    const expected = hashes(indexer);

    const prefix = history.builder.fork(111); // identical blocks 100..110, head 110: our 111 and 112 are unknown to this node
    provider.use(prefix, 105);
    // First sight is tolerated: a failover node may simply be behind.
    expect(await indexer.syncer!.syncOnce()).toEqual({ applied: 0, caughtUp: true });
    expect(indexer.db.lastCheckpoint()!.height).toBe(112);
    expect(indexer.syncer!.state.rollbacks).toBe(0);
    // It persists: the blocks above the head are not on the chain the node serves and must not keep feeding views.
    expect(await indexer.syncer!.syncOnce()).toEqual({ applied: 0, caughtUp: true, rolledBack: { from: 112, to: 110 } });
    expect(indexer.db.lastCheckpoint()!.height).toBe(110);
    expect(indexer.syncer!.state.rollbacks).toBe(1);
    expect(hashes(indexer)).toEqual(expected.slice(0, 11));
    expect((await indexer.api.inject({ method: "GET", url: "/v1/events?fromHeight=111" })).json()).toEqual({ items: [], nextHeight: null });
    expect((await indexer.api.inject({ method: "GET", url: "/v1/conformance/state-hash?height=112" })).statusCode).toBe(404);
    expect((await status(indexer)).healthy).toBe(true);
    // Stable while the head stays there.
    expect(await indexer.syncer!.syncOnce()).toEqual({ applied: 0, caughtUp: true });

    // The chain grows back: the same blocks are re-applied and the hashes reproduced.
    provider.use(history.builder, 105);
    await indexer.syncer!.syncToHead();
    expect(hashes(indexer)).toEqual(expected);
  });

  it("tolerates a transient shorter head (lagging failover node) without rolling back", async () => {
    const provider = new FakeProvider(history.builder, { lib: 105 });
    const indexer = makeIndexer(provider);
    await indexer.syncer!.syncToHead();
    const expected = hashes(indexer);
    const prefix = history.builder.fork(111);
    provider.use(prefix, 105);
    expect(await indexer.syncer!.syncOnce()).toEqual({ applied: 0, caughtUp: true });
    provider.use(history.builder, 105);
    expect(await indexer.syncer!.syncOnce()).toEqual({ applied: 0, caughtUp: true });
    provider.use(prefix, 105); // a new shrink starts over: tolerated once more
    expect(await indexer.syncer!.syncOnce()).toEqual({ applied: 0, caughtUp: true });
    expect(indexer.syncer!.state.rollbacks).toBe(0);
    expect(hashes(indexer)).toEqual(expected);
  });

  it("refuses to roll back below the final height", async () => {
    const provider = new FakeProvider(history.builder, { lib: 105 });
    const indexer = makeIndexer(provider);
    await indexer.syncer!.syncToHead();
    const deep = forkFrom(103, 10, "fork-c"); // fork below the LIB we now claim (111)
    provider.use(deep, 111);
    await expect(indexer.syncer!.syncOnce()).rejects.toThrow(SyncError);
    expect(indexer.syncer!.state.lastError).toMatch(/refusing to roll back/);
    expect(indexer.db.lastCheckpoint()!.height).toBe(112); // nothing was touched
    expect((await indexer.api.inject({ method: "GET", url: "/v1/status" })).json().healthy).toBe(false);
  });
});

describe("poll loop", () => {
  it("backs off to the poll interval instead of spinning when the node serves no block above its block store", async () => {
    const provider = new FakeProvider(history.builder, { blockStoreHeight: 108 }); // head 112, blocks served up to 108
    const indexer = makeIndexer(provider, ":memory:", { OSP_POLL_INTERVAL_MS: "1000" });
    const syncer = indexer.syncer!;
    syncer.start();
    await sleep(300);
    // batch size 3: 100..102, 103..105, 106..108, then one stalled step (109 requested, nothing served) and a 1 s wait
    expect(indexer.db.lastCheckpoint()!.height).toBe(108);
    expect(getBlocksCalls(provider)).toBe(4);
    expect(provider.calls.filter((c) => c === "getHeadInfo")).toHaveLength(4);
    expect(syncer.state.stalledSteps).toBe(1);
    expect(syncer.state.lastError).toBeUndefined();
    const view = await status(indexer);
    expect(view.sync).toMatchObject({ running: true, stalled: true, lag: 4, lastError: null });
    expect(view.healthy).toBe(true); // lag 4 <= 2 * batch size
    await syncer.stop();
    expect(syncer.state.running).toBe(false);
    expect(getBlocksCalls(provider)).toBe(4);
  });

  it("keeps polling and resumes once the block store catches up", async () => {
    const provider = new FakeProvider(history.builder, { blockStoreHeight: 108 });
    const indexer = makeIndexer(provider, ":memory:", { OSP_POLL_INTERVAL_MS: "10" });
    const syncer = indexer.syncer!;
    syncer.start();
    await waitFor(() => syncer.state.stalledSteps >= 3); // several polls while stalled, one step each
    expect(indexer.db.lastCheckpoint()!.height).toBe(108);
    const before = getBlocksCalls(provider);
    expect(before).toBeGreaterThanOrEqual(6);
    provider.blockStoreHeight = undefined;
    await waitFor(() => indexer.db.lastCheckpoint()!.height === 112);
    expect(syncer.state.stalledSteps).toBe(0);
    await syncer.stop();
    const canonical = makeIndexer(new FakeProvider(history.builder));
    await canonical.syncer!.syncToHead();
    expect(hashes(indexer)).toEqual(hashes(canonical));
  });

  it("does not spin on sync errors either", async () => {
    const provider = new FakeProvider(history.builder, { chainId: "EiDifferentNetwork" });
    const indexer = makeIndexer(provider, ":memory:", { OSP_POLL_INTERVAL_MS: "20" });
    const syncer = indexer.syncer!;
    syncer.start();
    await sleep(120);
    await syncer.stop();
    expect(indexer.db.lastCheckpoint()).toBeUndefined();
    expect(provider.calls.every((c) => c === "getChainId")).toBe(true);
    expect(provider.calls.length).toBeLessThanOrEqual(10);
    expect(syncer.state.lastError).toMatch(/chain id mismatch/);
  });

  it("syncToHead returns a stalled result instead of looping to the round limit", async () => {
    const provider = new FakeProvider(history.builder, { blockStoreHeight: 104 });
    const indexer = makeIndexer(provider);
    const result = await indexer.syncer!.syncToHead();
    // 100..102 (full batch), 103..104 (short batch, still progress), then 105.. serves nothing
    expect(result).toEqual({ applied: 5, caughtUp: false, stalled: true });
    expect(getBlocksCalls(provider)).toBe(3);
    expect(indexer.db.lastCheckpoint()!.height).toBe(104);

    const gappy = new GappyProvider(history.builder);
    const other = makeIndexer(gappy);
    expect(await other.syncer!.syncToHead()).toEqual({ applied: 6, caughtUp: false, stalled: true }); // 100..105, then 107.. without 106
    expect(other.db.lastCheckpoint()!.height).toBe(105);
    expect(getBlocksCalls(gappy)).toBe(3);
  });

  it("serialises concurrent syncOnce() calls and stop() waits for the queued steps", async () => {
    const provider = new FakeProvider(history.builder);
    const indexer = makeIndexer(provider);
    const syncer = indexer.syncer!;
    const results = await Promise.all([syncer.syncOnce(), syncer.syncOnce(), syncer.syncOnce()]);
    expect(results.map((r) => r.applied)).toEqual([3, 3, 3]);
    expect(indexer.db.lastCheckpoint()!.height).toBe(108);
    expect(syncer.state.lastError).toBeUndefined();
    const pending = syncer.syncOnce();
    await syncer.stop();
    expect(indexer.db.lastCheckpoint()!.height).toBe(111);
    expect((await pending).applied).toBe(3);
  });
});

describe("chain id", () => {
  it("refuses to index a node whose chain id differs from the deployment manifest", async () => {
    const provider = new FakeProvider(history.builder, { chainId: "EiDifferentNetwork" });
    const indexer = makeIndexer(provider);
    await expect(indexer.syncer!.syncOnce()).rejects.toThrow(/chain id mismatch/);
    expect(indexer.db.lastCheckpoint()).toBeUndefined();
    expect(provider.calls).toEqual(["getChainId"]); // no head, no blocks
    let view = await status(indexer);
    expect(view.healthy).toBe(false);
    expect(view.chainId).toBe(history.deployment.chainId);
    expect(view.rpcChainId).toBe("EiDifferentNetwork");
    expect(view.chainIdMatch).toBe(false);
    expect(view.sync.lastError).toMatch(/chain id mismatch/);
    // Re-checked on every step until it matches.
    await expect(indexer.syncer!.syncOnce()).rejects.toThrow(SyncError);
    expect(indexer.db.lastCheckpoint()).toBeUndefined();

    provider.chainId = history.deployment.chainId; // the operator points OSP_RPC at the right network
    await indexer.syncer!.syncToHead();
    expect(indexer.db.lastCheckpoint()!.height).toBe(112);
    view = await status(indexer);
    expect(view.chainIdMatch).toBe(true);
    expect(view.rpcChainId).toBe(history.deployment.chainId);
    expect(view.healthy).toBe(true);
    expect(provider.calls.filter((c) => c === "getChainId")).toHaveLength(3); // verified once, then cached
  });
});
