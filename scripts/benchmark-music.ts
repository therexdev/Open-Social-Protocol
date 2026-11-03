/** Reproducible byte/serialization benchmark. Optional RPC simulations NEVER broadcast.
 * node --import tsx scripts/benchmark-music.ts --audio song.mp3 --output result.json
 * Add --simulate --baseline-wasm before.wasm with KOINOS_HARBINGER_DEPLOYER_WIF set
 * to measure controlled upload batches at the node's current resource prices.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { Contract, Provider, Signer, Transaction, utils } from "koilib";
import { ABIS } from "@osp/proto";
import {
  ProtocolClient,
  contentHash,
  encode,
  identityFromSeed,
  loadDeployment,
  musicChunks,
  musicFee,
  musicPaymentOperations,
  toBase64url,
} from "@osp/sdk";
const flags = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((out, arg, i, all) => {
    if (arg.startsWith("--"))
      out.push([arg.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1] ?? "true"]);
    return out;
  }, [])
);
assert(flags.audio, "--audio path is required");
const audio = new Uint8Array(fs.readFileSync(flags.audio)),
  chunks = musicChunks(audio),
  digest = contentHash(audio);
const deployment = loadDeployment(
  JSON.parse(fs.readFileSync("deployments/harbinger.json", "utf8"))
);
const owner = identityFromSeed(new Uint8Array(32).fill(77)).account;
const manifest = {
  owner,
  digest,
  size: audio.length,
  chunk_hashes: chunks.map(contentHash),
  received: 0,
  title: "Good Vibes benchmark",
  mime: "audio/mpeg",
  duration_ms: 210000,
  fee: musicFee(audio.length),
  recipient: deployment.contracts.publications.address,
  payer: owner,
};
let previousManifestWrites = 0,
  progressWrites = 0,
  previousArguments = 0,
  batchedArguments = 0;
const id = new Uint8Array(32).fill(19);
for (let i = 0; i < chunks.length; i++) {
  previousManifestWrites += encode("publications.music_record", {
    ...manifest,
    received: i + 1,
  }).length;
  previousArguments += encode("publications.append_music_arguments", {
    owner,
    id,
    index: i,
    data: chunks[i],
  }).length;
}
for (let i = 0; i < chunks.length; i += 4) {
  progressWrites += encode("publications.music_progress", {
    received: Math.min(i + 4, chunks.length),
  }).length;
  batchedArguments += encode("publications.append_music_batch_arguments", {
    owner,
    id,
    index: i,
    chunks: chunks.slice(i, i + 4),
  }).length;
}
const report: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  filename: flags.audio.split("/").pop(),
  sha256: createHash("sha256").update(audio).digest("hex"),
  audioBytes: audio.length,
  ciphertextBytes: audio.length + 16,
  chunks: chunks.length,
  before: {
    uploadTransactions: 1 + chunks.length,
    appendTransactions: chunks.length,
    appendArgumentBytes: previousArguments,
    repeatedManifestSerializationBytes: previousManifestWrites,
  },
  after: {
    uploadTransactions: 1 + Math.ceil(chunks.length / 4),
    appendTransactions: Math.ceil(chunks.length / 4),
    appendArgumentBytes: batchedArguments,
    progressSerializationBytes: progressWrites,
  },
  applicationFeeKoin: Number(musicFee(audio.length)) / 1e8,
  notes: [
    "Same original audio bytes; no re-encoding.",
    "Counts exclude optional key deliveries, unlock purchases, and comments.",
    "Serialization bytes measure processing/writes, not net persistent disk growth or Mana savings.",
    "Application fee is unchanged. Transaction count is measured from the batching rules, not elapsed upload time.",
  ],
  mana: {
    status: "not_measured",
    reason: "A funded Harbinger payer is required for resource simulations.",
  },
};
if (flags.simulate) {
  try {
    assert(
      flags["baseline-wasm"],
      "--baseline-wasm is required for a controlled before/after comparison"
    );
    const wif = process.env.KOINOS_HARBINGER_DEPLOYER_WIF;
    assert(wif, "Set KOINOS_HARBINGER_DEPLOYER_WIF to a funded testnet account");
    const provider = new Provider([flags.rpc ?? "https://testnet.koinosfoundation.org/jsonrpc"]),
      payer = Signer.fromWif(wif),
      contract = new Signer({ privateKey: randomBytes(32) }),
      account = identityFromSeed(randomBytes(32));
    assert.equal(await provider.getChainId(), deployment.chainId, "Wrong chain: Harbinger only");
    const rc = await provider.getAccountRc(payer.getAddress());
    assert(
      BigInt(rc) >= 2000000000n,
      "Test payer needs at least 20 Mana for the non-broadcast simulations"
    );
    const nativeAddress = (await provider.invokeGetContractAddress("koin"))!.value.address;
    const native = new Contract({ id: nativeAddress, abi: utils.tokenAbi, provider });
    const client = new ProtocolClient({
      rpc: provider,
      deployment: {
        ...deployment,
        contracts: { ...deployment.contracts, publications: { address: contract.getAddress() } },
      },
    });
    const records: Record<string, unknown>[] = [];
    for (const version of ["before", "after"]) {
      const wasm = fs.readFileSync(
        version === "before"
          ? flags["baseline-wasm"]
          : "packages/contracts/build/release/publications.wasm"
      );
      for (const count of [0, 1, 4, 16]) {
        const begin = {
          ...manifest,
          owner: account.account,
          payer: account.account,
          id,
          max_fee: musicFee(audio.length, "1"),
          config_revision: 1,
        };
        const operations = [
          (
            await native.functions.transfer!(
              { from: payer.getAddress(), to: account.account, value: "100000000" },
              { onlyOperation: true }
            )
          ).operation!,
          await client.ops.identity.register({
            account: account.account,
            encryption_key: account.encryption.publicKey,
            key_version: 1,
          }),
          {
            upload_contract: {
              contract_id: contract.getAddress(),
              bytecode: toBase64url(wasm),
              authorizes_call_contract: false,
              authorizes_upload_contract: false,
              authorizes_transaction_application: false,
            },
          },
          await client.ops.publications.set_identity_contract({
            address: deployment.contracts.identity.address,
          }),
          await client.ops.publications.set_music_config({
            recipient: deployment.contracts.publications.address,
            rate_per_mb: "1",
            max_bytes: 10485760,
            enabled: true,
          }),
          ...(await musicPaymentOperations(client, begin, nativeAddress)),
        ];
        for (let i = 0; i < Math.min(count, chunks.length); i += version === "before" ? 1 : 4)
          operations.push(
            version === "before"
              ? await client.ops.publications.append_music({
                  owner: account.account,
                  id,
                  index: i,
                  data: chunks[i]!,
                })
              : await client.ops.publications.append_music_batch({
                  owner: account.account,
                  id,
                  index: i,
                  chunks: chunks.slice(i, Math.min(i + 4, count)),
                })
          );
        let tx = await Transaction.prepareTransaction(
          { header: { chain_id: deployment.chainId, rc_limit: rc }, operations },
          provider,
          payer.getAddress()
        );
        for (const signer of [payer, account.signer, contract])
          tx = await signer.signTransaction(tx);
        const { receipt } = await provider.sendTransaction(tx, false);
        assert(
          !receipt.reverted && !(receipt as { rpc_error?: unknown }).rpc_error,
          "Resource simulation failed"
        );
        records.push({
          version,
          chunks: count,
          wasmSha256: createHash("sha256").update(wasm).digest("hex"),
          receipt,
        });
      }
    }
    report.mana = {
      status: "simulated_batches",
      broadcast: false,
      cases: records,
      note: "Subtract each version's zero-chunk control to isolate append costs. This is not a full-song broadcast benchmark; transaction base costs and live resource prices also affect a full upload.",
    };
  } catch (e) {
    report.mana = { status: "blocked", reason: e instanceof Error ? e.message : String(e) };
  }
}
const json = JSON.stringify(report, null, 2) + "\n";
if (flags.output) fs.writeFileSync(flags.output, json);
console.log(json);
