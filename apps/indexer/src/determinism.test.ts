import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { IndexerDb, KoinosChain, SyncError, createIndexer, loadConfig, replayProjections, type Indexer } from "./index.js";
import { ChainBuilder, FakeProvider, ospEvent, tx } from "./testing/fake-chain.js";
import { buildHistory, type History } from "./testing/history.js";

const history: History = buildHistory();
const open: Indexer[] = [];

function makeIndexer(provider: FakeProvider, dbPath = ":memory:"): Indexer {
  const config = loadConfig({ OSP_NETWORK: "test", OSP_INDEXER_DB: dbPath, OSP_BATCH_SIZE: "3" }, { deployment: history.deployment });
  const indexer = createIndexer({ config, db: dbPath === ":memory:" ? IndexerDb.memory() : new IndexerDb(dbPath), chain: new KoinosChain(provider, history.deployment) });
  open.push(indexer);
  return indexer;
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
