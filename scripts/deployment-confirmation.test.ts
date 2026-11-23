import assert from "node:assert/strict";
import test from "node:test";
import { confirmDeploymentTransaction, DeploymentTransactionRevertedError, requireFreshDeploymentHead } from "./deployment-confirmation.ts";

const NOW = 1_800_000_000_000;
function head(height = 43, timestamp = NOW - 1000, id = "canonical-head") {
  return { head_topology: { height: String(height), id, previous: "previous" }, head_block_time: String(timestamp), last_irreversible_block: "1", head_state_merkle_root: "root" };
}
type P = Parameters<typeof confirmDeploymentTransaction>[0];
function block(height: number, ids: string[] = []) {
  return { block_id: `canonical-${height}`, block_height: String(height), receipt: { transaction_receipts: ids.map(id => ({ id, reverted: false, rc_used: "123" })) } };
}
function clock() {
  let time = 0;
  return { now: () => time, sleep: async (ms: number) => { time += ms; }, timeoutMs: 5000 };
}

test("rejects a responding RPC whose last block is stale before deployment can proceed", async () => {
  await assert.rejects(requireFreshDeploymentHead({ getHeadInfo: async () => head(10307422, NOW - 13 * 3600_000) }, { now: () => NOW }), /stale.*10307422.*No new deployment transaction will be submitted/s);
  const fresh = await requireFreshDeploymentHead({ getHeadInfo: async () => head() }, { now: () => NOW });
  assert.equal(fresh.head_topology.height, "43");
});
test("rejects missing, invalid and future block timestamps", async () => {
  for (const timestamp of [0, NaN, NOW + 120_000]) {
    await assert.rejects(requireFreshDeploymentHead({ getHeadInfo: async () => head(43, timestamp) }, { now: () => NOW }), /invalid head/);
  }
});
test("finds an upload confirmed before the first poll using canonical receipts without block bodies", async () => {
  const calls: unknown[][] = [];
  const provider = {
    getHeadInfo: async () => head(43),
    getBlocks: async (...args: unknown[]) => { calls.push(args); return [block(40), block(41, ["upload"]), block(42), block(43)]; },
  } as unknown as P;
  const result = await confirmDeploymentTransaction(provider, "upload", 40, clock());
  assert.equal(result.blockNumber, 41);
  assert.equal(result.receipt.rc_used, "123");
  assert.deepEqual(calls, [[40, 4, "canonical-head", { returnBlock: false, returnReceipt: true }]]);
});
test("rechecks earlier heights against a changed fork instead of permanently skipping them", async () => {
  let reads = 0;
  const forks: string[] = [];
  const provider = {
    getHeadInfo: async () => head(43, NOW, reads++ ? "new-fork" : "old-fork"),
    getBlocks: async (_from: number, _count: number, reference: string) => {
      forks.push(reference);
      return [block(41, reference === "new-fork" ? ["upload"] : ["other"] )];
    },
  } as unknown as P;
  assert.equal((await confirmDeploymentTransaction(provider, "upload", 40, clock())).blockNumber, 41);
  assert.deepEqual(forks, ["old-fork", "new-fork"]);
});
test("a reverted canonical transaction fails immediately and is never treated as a successful upload", async () => {
  const b = block(41, ["upload"]); b.receipt.transaction_receipts[0]!.reverted = true;
  const provider = { getHeadInfo: async () => head(), getBlocks: async () => [b] } as unknown as P;
  await assert.rejects(confirmDeploymentTransaction(provider, "upload", 40, { ...clock(), sleep: async () => assert.fail("must stop on revert") }), DeploymentTransactionRevertedError);
});
test("temporary read errors retry confirmation without a new transaction", async () => {
  let calls = 0;
  const provider = { getHeadInfo: async () => head(), getBlocks: async () => { if (!calls++) throw Error("RPC unavailable"); return [block(41, ["upload"])]; } } as unknown as P;
  assert.equal((await confirmDeploymentTransaction(provider, "upload", 40, clock())).blockNumber, 41);
  assert.equal(calls, 2);
});
test("an unknown outcome retains its transaction ID and can be reconciled from the same checkpoint on a later run", async () => {
  const checkpoint = { txId: "saved-upload", startBlock: "40" };
  let included = false;
  const provider = { getHeadInfo: async () => head(), getBlocks: async () => [block(41, included ? [checkpoint.txId] : [])] } as unknown as P;
  await assert.rejects(confirmDeploymentTransaction(provider, checkpoint.txId, Number(checkpoint.startBlock), clock()), /still unknown.*saved-upload|saved-upload.*still unknown/s);
  included = true;
  const result = await confirmDeploymentTransaction(provider, checkpoint.txId, Number(checkpoint.startBlock), clock());
  assert.equal(result.blockNumber, 41);
  assert.deepEqual(checkpoint, { txId: "saved-upload", startBlock: "40" });
});
test("confirmation batches a large range and does not accept receipts outside the requested range", async () => {
  const ranges: [number, number][] = [];
  const provider = {
    getHeadInfo: async () => head(170),
    getBlocks: async (from: number, count: number) => { ranges.push([from, count]); return [block(from === 168 ? 169 : 999, ["upload"])]; },
  } as unknown as P;
  assert.equal((await confirmDeploymentTransaction(provider, "upload", 40, clock())).blockNumber, 169);
  assert.deepEqual(ranges, [[40, 64], [104, 64], [168, 3]]);
});
