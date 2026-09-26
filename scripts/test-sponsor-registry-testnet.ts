// Rehearse the actual sponsor service payload on an isolated Harbinger contract.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Contract, utils, type OperationJson } from "koilib";
import { ABIS } from "@osp/proto";
import { ProtocolClient, loadDeployment } from "@osp/sdk";
import { buildAllowlist } from "../apps/sponsor/src/policy.ts";
import { desiredRecord, recordMatches } from "../apps/sponsor/src/register.ts";
import { contractSigner, deployerSigner, networkFromArgs, parseArgs, providerFor, readDeployment, readContractArtifacts, requireSeed } from "./common.ts";
import { submitMeasured } from "./deployment-transactions.ts";
import { sponsorPolicyBytes } from "./sponsor-registration-wire.ts";

const args = parseArgs(process.argv.slice(2));
const { name: network, preset } = networkFromArgs(args);
assert.equal(network, "harbinger");
assert(args.execute, "Explicit --execute is required");
assert(typeof args.evidence === "string", "--evidence path is required");
const deployment = loadDeployment(readDeployment(network));
const provider = providerFor(preset);
assert.equal(await provider.getChainId(), deployment.chainId);
const payer = deployerSigner(preset, provider);
const run = typeof args.run === "string" ? args.run : randomBytes(8).toString("hex");
assert(/^[a-zA-Z0-9_-]{1,80}$/.test(run));
const owner = contractSigner(network, `sponsor-registry-rehearsal-${run}`, requireSeed(), provider);
assert.notEqual(owner.getAddress(), deployment.contracts.sponsorship.address);
const art = readContractArtifacts("sponsorship");
const registry = new Contract({ id: owner.getAddress(), abi: ABIS.sponsorship as never, bytecode: art.wasm, provider, signer: owner, options: { payer: payer.getAddress() } });
const client = new ProtocolClient({ rpc: provider, deployment: { ...deployment, contracts: { ...deployment.contracts, sponsorship: { ...deployment.contracts.sponsorship, address: owner.getAddress() } } } });
const policy = desiredRecord({
  sponsor: payer.getAddress(), publicUrl: "https://social-sponsor.usekoinos.com",
  allowlist: buildAllowlist(deployment),
  limits: { version: 2, dailyOps: 200, burstOps: 20, burstWindowSec: 60, maxBytesPerOp: 6144, maxRcPerOp: "200000000", maxOpsPerTx: 4 },
});
const evidence: { run: string; contract: string; wasmSha256: string; started: string; finished?: string; checks: Array<{ name: string; txId?: string; block?: number; rc?: string }> } = {
  run, contract: owner.getAddress(), wasmSha256: art.wasmSha256, started: new Date().toISOString(), checks: [],
};
function save() {
  mkdirSync(dirname(String(args.evidence)), { recursive: true });
  writeFileSync(String(args.evidence), JSON.stringify(evidence, null, 2) + "\n");
}
function check(name: string) { evidence.checks.push({ name }); console.log(`PASS ${name}`); save(); }
async function send(name: string, operations: OperationJson[]) {
  const prepared = await client.prepare(operations, { payer: payer.getAddress(), payee: payer.getAddress() });
  const result = await submitMeasured(prepared, provider, [payer], { log: console.log });
  const block = await result.transaction.wait("byTransactionId", 120000);
  evidence.checks.push({ name, txId: result.transaction.id, block: block.blockNumber, rc: result.receipt.rc_used });
  console.log(`PASS ${name}: ${result.transaction.id}`); save();
}
async function refuse(name: string, operation: OperationJson, pattern: RegExp) {
  const prepared = await client.prepare([operation], { payer: payer.getAddress(), payee: payer.getAddress() });
  await assert.rejects(submitMeasured(prepared, provider, [payer], { dryRun: true }), pattern);
  check(name);
}
try {
  const upload = await registry.deploy({ abi: art.abi, sendTransaction: false, signTransaction: false });
  const sent = await submitMeasured(upload.transaction!, provider, [owner, payer], { log: console.log });
  const block = await sent.transaction.wait("byTransactionId", 120000);
  evidence.checks.push({ name: "isolated-registry-upload", txId: sent.transaction.id, block: block.blockNumber, rc: sent.receipt.rc_used }); save();
  await send("register-actual-service-policy", [await client.ops.sponsorship.set_sponsor(policy)]);
  assert(recordMatches((await client.reads.sponsorship.get_sponsor({ sponsor: payer.getAddress() }))?.value, policy));
  check("actual-service-policy-round-trips");
  for (const format of ["unpacked", "mixed", "packed"] as const) {
    await send(`register-${format}-policy`, [{ call_contract: { contract_id: owner.getAddress(), entry_point: ABIS.sponsorship.methods.set_sponsor!.entry_point, args: utils.encodeBase64url(sponsorPolicyBytes(policy, format)) } }]);
    assert(recordMatches((await client.reads.sponsorship.get_sponsor({ sponsor: payer.getAddress() }))?.value, policy));
    check(`${format}-policy-round-trips`);
  }
  await refuse("cannot-register-another-sponsor", await client.ops.sponsorship.set_sponsor({ ...policy, sponsor: owner.getAddress() }), /authoriz|authority|sign/i);
  await refuse("entry-point-limit-enforced", await client.ops.sponsorship.set_sponsor({ ...policy, allowed: [{ contract_id: deployment.contracts.token.address, entry_points: Array(65).fill(1) }] }), /too many entry points/i);
  assert(recordMatches((await client.reads.sponsorship.list_sponsors({ limit: 1 }))?.values?.[0], policy));
  check("registry-discovery-matches-signed-policy");
  await send("deactivate-rehearsal-sponsor", [await client.ops.sponsorship.deactivate_sponsor({ sponsor: payer.getAddress() })]);
  assert.equal(Boolean((await client.reads.sponsorship.get_sponsor({ sponsor: payer.getAddress() }))?.value?.active), false);
  check("deactivation-persists");
  evidence.finished = new Date().toISOString(); save();
  console.log(`Completed ${evidence.checks.length} sponsor registry checks. Existing public registry was not changed.`);
} catch (error) { save(); throw error; }
