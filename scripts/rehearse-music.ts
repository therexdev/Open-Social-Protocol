// Harbinger-only, NON-BROADCAST integration rehearsal against the deployed native token.
// Uses KOINOS_HARBINGER_DEPLOYER_WIF only as simulation funding; commits no state.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Contract, Signer, Transaction, utils } from "koilib";
import { ABIS } from "@osp/proto";
import {
  ProtocolClient,
  contentHash,
  decode,
  fromBase64url,
  identityFromSeed,
  loadDeployment,
  musicPaymentOperations,
} from "@osp/sdk";
import {
  deployerSigner,
  networkFromArgs,
  parseArgs,
  providerFor,
  readContractArtifacts,
  readDeployment,
} from "./common.ts";
const { name: network, preset } = networkFromArgs(
  parseArgs(process.argv.slice(2))
);
assert.equal(network, "harbinger", "Rehearsal is Harbinger-only");
const provider = providerFor(preset),
  deployment = loadDeployment(readDeployment(network));
assert.equal(await provider.getChainId(), deployment.chainId, "Wrong chain");
const payer = deployerSigner(preset, provider),
  contract = new Signer({ privateKey: randomBytes(32) }),
  account = identityFromSeed(randomBytes(32)),
  recipient = new Signer({ privateKey: randomBytes(32) }).getAddress();
const client = new ProtocolClient({
  rpc: provider,
  deployment: {
    ...deployment,
    contracts: {
      ...deployment.contracts,
      publications: { address: contract.getAddress() },
    },
  },
});
const nativeAddress = (await provider.invokeGetContractAddress("koin"))?.value
  .address;
assert(nativeAddress, "Native KOIN could not be resolved");
const native = new Contract({
  id: nativeAddress,
  abi: utils.tokenAbi,
  provider,
});
const data = new Uint8Array([73, 68, 51, 1, 2, 3]),
  digest = contentHash(data),
  id = randomBytes(32),
  artifacts = readContractArtifacts("publications");
const begin = {
  owner: account.account,
  payer: account.account,
  id,
  digest,
  size: data.length,
  chunk_hashes: [digest],
  title: "Payment simulation only",
  mime: "audio/mpeg",
  duration_ms: 210000,
  config_revision: 1,
  max_fee: "100000000",
};
const payment = await musicPaymentOperations(client, begin, nativeAddress);
const operations = [
  (
    await native.functions.transfer!(
      { from: payer.getAddress(), to: account.account, value: "200000000" },
      { onlyOperation: true }
    )
  ).operation,
  await client.ops.identity.register({
    account: account.account,
    encryption_key: account.encryption.publicKey,
    key_version: 1,
  }),
  {
    upload_contract: {
      contract_id: contract.getAddress(),
      bytecode: utils.encodeBase64url(artifacts.wasm),
      abi: JSON.stringify(ABIS.publications),
      authorizes_call_contract: false,
      authorizes_upload_contract: false,
      authorizes_transaction_application: false,
    },
  },
  await client.ops.publications.set_identity_contract({
    address: deployment.contracts.identity.address,
  }),
  await client.ops.publications.set_music_config({
    recipient,
    rate_per_mb: "8610000000",
    max_bytes: 10485760,
    enabled: true,
  }),
  ...payment,
  ...payment,
  await client.ops.publications.append_music({
    owner: account.account,
    id,
    index: 0,
    data,
  }),
  await client.ops.publications.append_music({
    owner: account.account,
    id,
    index: 0,
    data,
  }),
  await client.contracts.operation("publications", "get_music", { id }),
  await client.contracts.operation("publications", "get_music_chunk", {
    id,
    index: 0,
  }),
  await client.contracts.operation("publications", "list_music", {
    owner: account.account,
  }),
];
let tx = await Transaction.prepareTransaction(
  {
    header: {
      chain_id: deployment.chainId,
      rc_limit: await provider.getAccountRc(payer.getAddress()),
    },
    operations,
  },
  provider,
  payer.getAddress()
);
for (const signer of [payer, account.signer, contract])
  tx = await signer.signTransaction(tx);
const { receipt } = await provider.sendTransaction(tx, false); // Deliberately no broadcast option.
assert(!receipt.reverted, "Simulation reverted");
assert(
  !(receipt as { rpc_error?: unknown }).rpc_error,
  "Simulation outcome is unknown"
);
const events = receipt.events ?? [];
const transfers = events
  .filter(
    (e) => e.source === nativeAddress && e.name === "token.transfer_event"
  )
  .map((e) =>
    decode<{ from: string; to: string; value: string }>(
      "token.transfer_event",
      fromBase64url(e.data)
    )
  );
const fees = transfers.filter(
  (t) => t.from === account.account && t.to === recipient
);
assert.equal(fees.length, 1, "Upload fee must transfer exactly once");
assert.equal(fees[0]!.value, "100000000");
assert.equal(
  events.filter((e) => e.name === "osp.publications.music_paid").length,
  1
);
assert.equal(
  events.filter((e) => e.name === "osp.publications.music_completed").length,
  1
);
const approvals = events
  .filter((e) => e.source === nativeAddress && e.name === "token.approve_event")
  .map((e) =>
    decode<{ owner: string; spender: string; value: string }>(
      "publications.music_native_approval",
      fromBase64url(e.data)
    )
  );
assert.deepEqual(
  approvals.map((a) => a.value),
  ["100000000", "0", "100000000", "0"],
  "Both attempts must clear their allowances"
);
console.log(
  JSON.stringify(
    {
      broadcast: false,
      network,
      chainId: deployment.chainId,
      nativeAddress,
      wasmSha256: artifacts.wasmSha256,
      rcUsed: receipt.rc_used,
      paymentAttempts: 2,
      uploadFeeTransfers: fees.length,
      feeAtomic: fees[0]!.value,
      cleanupVerified: true,
      completedEvents: 1,
      simulatedAt: new Date().toISOString(),
    },
    null,
    2
  )
);
