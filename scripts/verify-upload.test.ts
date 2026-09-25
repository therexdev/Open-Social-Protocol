import test from "node:test";
import assert from "node:assert/strict";
import { verifyUpload } from "./verify-upload.ts";
import { sha256Hex, deploymentPath } from "./common.ts";

const abi = '{"methods":{}}';
const bytecode = Buffer.from("test-wasm");
const entry = { address: "contract", txId: "tx", block: "42", wasmSha256: sha256Hex(bytecode), abiSha256: sha256Hex(Buffer.from(abi)), rcUsed: "1" };
function fixture() {
  const block = { block_height: "42", block: { transactions: [{ id: "tx", operations: [{ upload_contract: { contract_id: "contract", bytecode: bytecode.toString("base64url"), abi } }] }] }, receipt: { transaction_receipts: [{ id: "tx", reverted: false }] } };
  const provider = { getBlocks: async () => [block], call: async () => ({ meta: { abi } }) } as unknown as Parameters<typeof verifyUpload>[0];
  return { block, provider };
}
test("resume checkpoints are kept outside frontend deployment manifests", () => {
  assert.notEqual(deploymentPath("harbinger"), deploymentPath("harbinger", true));
  assert.match(deploymentPath("harbinger", true), /deployment-progress/);
});
test("verifies a successful canonical upload and its current ABI", async () => {
  assert.equal(await verifyUpload(fixture().provider, entry), true);
});
test("rejects reverts, missing/reorged uploads, and mismatching bytecode or ABI", async () => {
  const reverted = fixture(); reverted.block.receipt.transaction_receipts[0]!.reverted = true;
  assert.equal(await verifyUpload(reverted.provider, entry), false);
  const reorged = fixture(); reorged.block.block.transactions[0]!.id = "other";
  assert.equal(await verifyUpload(reorged.provider, entry), false);
  assert.equal(await verifyUpload(fixture().provider, { ...entry, wasmSha256: "wrong" }), false);
  assert.equal(await verifyUpload(fixture().provider, { ...entry, abiSha256: "wrong" }), false);
  assert.equal(await verifyUpload(fixture().provider, { ...entry, block: "" }), false);
});
