import test from "node:test";
import assert from "node:assert/strict";
import { Signer, Transaction, type ProviderInterface, type TransactionJson, type TransactionReceipt } from "koilib";
import { submitMeasured } from "./deployment-transactions.ts";

const owner = Signer.fromSeed("deployment-test-contract");
const payer = Signer.fromSeed("deployment-test-payer");
async function fixture() {
  return Transaction.prepareTransaction({
    header: { chain_id: "EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==", payer: payer.getAddress(), nonce: "KAE=", rc_limit: "10000000000" },
    operations: [{ upload_contract: { contract_id: owner.getAddress(), bytecode: "AA==" } }],
  });
}
function harness(options: { measured?: string; available?: string; pending?: number; fail?: Error; unknown?: boolean; reverted?: boolean } = {}) {
  const requests: { transaction: TransactionJson; broadcast: boolean }[] = [];
  let pending = options.pending ?? 0;
  const provider = {
    getAccountRc: async () => options.available ?? "10000000000",
    sendTransaction: async (tx: TransactionJson, broadcast = true) => {
      requests.push({ transaction: JSON.parse(JSON.stringify(tx)), broadcast });
      if (broadcast && pending-- > 0) throw new Error(JSON.stringify({ error: "insufficient pending account resources", code: 104 }));
      if (broadcast && options.fail) throw options.fail;
      const receipt = { id: tx.id, rc_used: options.measured ?? "514579865", reverted: options.reverted ?? false,
        ...(options.unknown && { rpc_error: { error: "rpc failed, context deadline exceeded" } }),
      } as TransactionReceipt;
      return { receipt, transaction: { ...tx, wait: async () => ({ blockId: "block", blockNumber: 10 }) } };
    },
  } satisfies Pick<ProviderInterface, "getAccountRc" | "sendTransaction">;
  return { provider, requests };
}

test("reserves measured Mana and re-signs both contract and payer after changing the transaction ID", async () => {
  const h = harness();
  await submitMeasured(await fixture(), h.provider, [owner, payer, payer]);
  assert.deepEqual(h.requests.map(r => r.broadcast), [false, true]);
  const [simulation, sent] = h.requests.map(r => r.transaction);
  assert.equal(simulation!.header!.rc_limit, "10000000000");
  assert.equal(sent!.header!.rc_limit, "566047852");
  assert.notEqual(sent!.id, simulation!.id);
  for (const tx of [simulation!, sent!]) {
    assert.equal(tx.id, Transaction.computeTransactionId(tx.header!));
    assert.deepEqual((await Signer.recoverAddresses(tx)).sort(), [owner.getAddress(), payer.getAddress()].sort());
    assert.equal(tx.signatures!.length, 2);
  }
});

test("pending-resource refusal retries the identical signed transaction", async () => {
  const h = harness({ pending: 2 });
  const waits: number[] = [];
  await submitMeasured(await fixture(), h.provider, [owner, payer], { sleep: async ms => { waits.push(ms); } });
  assert.deepEqual(waits, [5000, 5000]);
  assert.deepEqual(h.requests[1], h.requests[2]);
  assert.deepEqual(h.requests[2], h.requests[3]);
});

test("pending retries are bounded", async () => {
  const h = harness({ pending: 10 });
  await assert.rejects(submitMeasured(await fixture(), h.provider, [owner, payer], { maxPendingRetries: 1, sleep: async () => {} }), /pending account resources/);
  assert.equal(h.requests.length, 3);
});

test("dry runs simulate without broadcasting", async () => {
  const h = harness();
  await submitMeasured(await fixture(), h.provider, [owner, payer], { dryRun: true });
  assert.deepEqual(h.requests.map(r => r.broadcast), [false]);
});

test("simulation errors and actual insufficient Mana stop before broadcasting", async () => {
  for (const options of [{ reverted: true }, { unknown: true }, { measured: "" }, { available: "100" }]) {
    const h = harness(options);
    await assert.rejects(submitMeasured(await fixture(), h.provider, [owner, payer]));
    assert.deepEqual(h.requests.map(r => r.broadcast), [false]);
  }
});

test("broadcast timeouts and other errors are never blindly retried", async () => {
  for (const fail of [new Error("fetch failed"), new Error('{"error":"invalid nonce","code":1}')]) {
    const h = harness({ fail });
    await assert.rejects(submitMeasured(await fixture(), h.provider, [owner, payer], { sleep: async () => assert.fail("must not retry") }));
    assert.equal(h.requests.length, 2);
  }
});
