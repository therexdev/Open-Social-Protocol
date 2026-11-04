// Read-only rollout check: node --import tsx scripts/verify-music.ts --network harbinger
import assert from "node:assert/strict";
import { ABIS } from "@osp/proto";
import {
  ProtocolClient,
  loadDeployment,
  musicConfig,
  musicFee,
  verifySponsorDiscovery,
  NATIVE_APPROVE_ENTRY,
  MUSIC_BATCH_ARGUMENT_BYTES,
  type SponsorDiscovery,
} from "@osp/sdk";
import { networkFromArgs, parseArgs, readDeployment } from "./common.ts";
const args = parseArgs(process.argv.slice(2)),
  { name: network } = networkFromArgs(args);
const deployment = loadDeployment(readDeployment(network)),
  client = new ProtocolClient({ deployment });
assert.equal(await client.provider.getChainId(), deployment.chainId, "RPC chain mismatch");
const config = await musicConfig(client);
console.log(
  JSON.stringify(
    {
      network,
      music: config,
      benchmarkFee: musicFee(8403113, config.rate_per_mb, config.flat_fee),
    },
    null,
    2
  )
);
assert.equal(config.version, 3, "Upgrade publications for Music v3 transfers");
if (args.gallery) {
  assert.equal((await client.reads.publications.get_music_art_version({}))?.version, 1, "Upgrade publications for music artwork and flat fees");
  assert.equal(config.flat_fee, "10000000000", "Activate the flat 100 tKOIN music fee");
}
assert(config.enabled, "Music uploads are not enabled");
await client.reads.publications.list_music_requests({ owner: config.recipient });
await client.reads.publications.list_music_comments({ id: new Uint8Array(32) });
await client.reads.token.get_music_payment({ id: new Uint8Array(32) });
await client.reads.publications.get_music_chunks({ id: new Uint8Array(32), index: 0, count: 16 });

assert.equal(
  (await client.provider.invokeGetContractAddress?.("koin"))?.value.address,
  config.native_token,
  "Native token does not match Koinos name service"
);
if (!args["contracts-only"]) {
  const endpoint = typeof args.sponsor === "string" ? args.sponsor : deployment.sponsors?.[0];
  assert(endpoint, "Specify --sponsor");
  const json = async (path: string) => {
    const r = await fetch(`${endpoint.replace(/\/+$/, "")}${path}`, {
      signal: AbortSignal.timeout(20000),
    });
    assert(r.ok, `HTTP ${r.status}`);
    return r.json();
  };
  const discovery = (await json("/.well-known/osp-sponsor.json")) as SponsorDiscovery;
  const health = await json("/healthz");
  assert.equal(
    health.features?.musicUploads,
    1,
    "Restart the updated sponsor after upgrading the contract"
  );
  assert(verifySponsorDiscovery(discovery).valid, "Invalid sponsor signature");
  assert.equal(discovery.network.chainId, deployment.chainId, "Sponsor chain mismatch");
  assert.equal(
    discovery.sponsor,
    config.recipient,
    "Music fees must reach this sponsor for sponsored uploads"
  );
  assert(health.features?.musicBatching >= 2, "Restart the Music v3 sponsor");
  const policy = discovery.policy;
  if (args.gallery) assert(policy.version >= 5, "Restart the sponsor with policy version 5");
  assert(policy.version >= 4, "Sixteen-chunk music batching requires sponsor policy v4");
  assert(
    policy.maxBytesPerOp >= MUSIC_BATCH_ARGUMENT_BYTES && Number(policy.maxOpsPerTx) >= 3,
    "Sponsor needs 266 KiB arguments and 3 operations per transaction"
  );
  for (const [address, entry] of [
    [config.native_token, NATIVE_APPROVE_ENTRY],
    ...[
      "begin_music",
      "append_music",
      "append_music_batch",
      "request_music_access",
      "grant_music_access",
      "refund_music_access",
      "comment_music",
      "delete_music_comment",
      ...(args.gallery ? ["set_music_cover"] : []),
    ].map((method) => [
      deployment.contracts.publications.address,
      ABIS.publications.methods[method]!.entry_point,
    ]),
  ] as Array<[string, number]>) {
    assert(
      policy.allowed.some((x) => x.contract === address && x.entryPoints.includes(entry)),
      `Missing sponsored entry point ${address}:${entry}`
    );
  }
  const registered = (await client.reads.sponsorship.get_sponsor({ sponsor: discovery.sponsor }))
    ?.value;
  if (args.gallery) assert((registered?.policy_version ?? 0) >= 5, "Register sponsor policy version 5");
  assert(registered?.active, "Sponsor on-chain registration is not active");
  assert(registered.max_bytes_per_op >= MUSIC_BATCH_ARGUMENT_BYTES && registered.policy_version >= 4,
    "Upgrade sponsorship registry and refresh the on-chain policy v4 registration");
  assert(
    registered.allowed.some(
      (x) => x.contract_id === config.native_token && x.entry_points.includes(NATIVE_APPROVE_ENTRY)
    ),
    "Sponsor must refresh its on-chain native payment policy"
  );
}
if (args.gallery && !args["contracts-only"]) {
  const endpoint = typeof args.indexer === "string" ? args.indexer : deployment.indexers?.[0];
  assert(endpoint, "Specify --indexer for the music feed check");
  const response = await fetch(`${String(endpoint).replace(/\/+$/, "")}/v1/status`, { signal: AbortSignal.timeout(20000) });
  assert(response.ok, "Indexer status unavailable");
  const status = await response.json();
  assert.equal(status.features?.musicFeed, 1, "Restart the updated indexer for music in the feed");
}
console.log(
  "MUSIC READY — deploy the frontend and perform a small paid upload before the full 3:30 test."
);
