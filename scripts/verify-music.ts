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
  type SponsorDiscovery,
} from "@osp/sdk";
import { networkFromArgs, parseArgs, readDeployment } from "./common.ts";
const args = parseArgs(process.argv.slice(2)),
  { name: network } = networkFromArgs(args);
const deployment = loadDeployment(readDeployment(network)),
  client = new ProtocolClient({ deployment });
assert.equal(
  await client.provider.getChainId(),
  deployment.chainId,
  "RPC chain mismatch"
);
const config = await musicConfig(client);
console.log(
  JSON.stringify(
    {
      network,
      music: config,
      benchmarkFee: musicFee(8403113, config.rate_per_mb),
    },
    null,
    2
  )
);
assert(config.enabled, "Music uploads are not enabled");
assert.equal(
  (await client.provider.invokeGetContractAddress?.("koin"))?.value.address,
  config.native_token,
  "Native token does not match Koinos name service"
);
if (!args["contracts-only"]) {
  const endpoint =
    typeof args.sponsor === "string" ? args.sponsor : deployment.sponsors?.[0];
  assert(endpoint, "Specify --sponsor");
  const json = async (path: string) => {
    const r = await fetch(`${endpoint.replace(/\/+$/, "")}${path}`, {
      signal: AbortSignal.timeout(20000),
    });
    assert(r.ok, `HTTP ${r.status}`);
    return r.json();
  };
  const discovery = (await json(
    "/.well-known/osp-sponsor.json"
  )) as SponsorDiscovery;
  const health = await json("/healthz");
  assert.equal(
    health.features?.musicUploads,
    1,
    "Restart the updated sponsor after upgrading the contract"
  );
  assert(verifySponsorDiscovery(discovery).valid, "Invalid sponsor signature");
  assert.equal(
    discovery.network.chainId,
    deployment.chainId,
    "Sponsor chain mismatch"
  );
  assert.equal(
    discovery.sponsor,
    config.recipient,
    "Music fees must reach this sponsor for sponsored uploads"
  );
  const policy = discovery.policy;
  assert(
    policy.maxBytesPerOp >= 24576 && Number(policy.maxOpsPerTx) >= 3,
    "Sponsor needs 24 KiB arguments and 3 operations per transaction"
  );
  for (const [address, entry] of [
    [config.native_token, NATIVE_APPROVE_ENTRY],
    ...["begin_music", "append_music"].map((method) => [
      deployment.contracts.publications.address,
      ABIS.publications.methods[method]!.entry_point,
    ]),
  ] as Array<[string, number]>) {
    assert(
      policy.allowed.some(
        (x) => x.contract === address && x.entryPoints.includes(entry)
      ),
      `Missing sponsored entry point ${address}:${entry}`
    );
  }
  const registered = (
    await client.reads.sponsorship.get_sponsor({ sponsor: discovery.sponsor })
  )?.value;
  assert(registered?.active, "Sponsor on-chain registration is not active");
  assert(
    registered.allowed.some(
      (x) =>
        x.contract_id === config.native_token &&
        x.entry_points.includes(NATIVE_APPROVE_ENTRY)
    ),
    "Sponsor must refresh its on-chain native payment policy"
  );
}
console.log(
  "MUSIC READY — deploy the frontend and perform a small paid upload before the full 3:30 test."
);
