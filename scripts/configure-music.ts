// Read the proposed policy by default; --execute simulates and applies it with the contract key.
import assert from "node:assert/strict";
import { Contract, utils } from "koilib";
import { ABIS } from "@osp/proto";
import {
  isAddress,
  loadDeployment,
  musicFee,
  verifySponsorDiscovery,
  type MusicConfig,
  type SponsorDiscovery,
} from "@osp/sdk";
import {
  contractSigner,
  deployerSigner,
  networkFromArgs,
  parseArgs,
  providerFor,
  readDeployment,
  requireSeed,
} from "./common.ts";
import { submitMeasured } from "./deployment-transactions.ts";

const args = parseArgs(process.argv.slice(2)),
  { name: network, preset } = networkFromArgs(args);
const deployment = loadDeployment(readDeployment(network)),
  provider = providerFor(preset);
assert.equal(await provider.getChainId(), deployment.chainId, "Wrong chain");
let recipient = typeof args.recipient === "string" ? args.recipient : undefined;
if (!recipient) {
  const endpoint = deployment.sponsors?.[0];
  assert(endpoint, "Specify --recipient with the wallet that will receive music fees");
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/.well-known/osp-sponsor.json`, {
    signal: AbortSignal.timeout(20000),
  });
  assert(response.ok, "Could not read the existing Mana sponsor; specify --recipient");
  const discovery = (await response.json()) as SponsorDiscovery;
  assert(verifySponsorDiscovery(discovery).valid, "Invalid sponsor discovery signature");
  assert.equal(discovery.network.chainId, deployment.chainId, "Sponsor is on another chain");
  recipient = discovery.sponsor;
}
assert(isAddress(recipient), "Recipient must be a valid Koinos address");
const rate = typeof args["rate-per-mb"] === "string" ? args["rate-per-mb"] : "86.1";
assert(/^\d+(\.\d{1,8})?$/.test(rate), "Rate must be a positive decimal with at most 8 decimals");
const rate_per_mb = utils.parseUnits(rate, 8);
musicFee(1, rate_per_mb); // shared bounds
const max_bytes = Number(args["max-bytes"] ?? 10485760);
assert(
  Number.isInteger(max_bytes) && max_bytes > 0 && max_bytes <= 10485760,
  "Size limit must be 1–10485760 bytes"
);
const flat = typeof args["flat-fee"] === "string" ? args["flat-fee"] : "100";
assert(/^\d+(\.\d{1,8})?$/.test(flat), "Flat fee must have at most 8 decimals; use 0 for legacy per-MB pricing");
const flat_fee = utils.parseUnits(flat, 8);
musicFee(1, rate_per_mb, flat_fee);
const policy = {
  flat_fee,
  recipient,
  rate_per_mb,
  max_bytes,
  enabled: args.pause !== true,
};
const contract = new Contract({
  id: deployment.contracts.publications.address,
  abi: ABIS.publications as never,
  provider,
});
const current = (await contract.functions.get_music_config!({})).result as
  | { value?: MusicConfig }
  | undefined;
assert(
  [1, 2, 3].includes(current?.value?.version ?? 0),
  "Upgrade publications before configuring Music"
);
if (BigInt(flat_fee) > 0n) {
  const art = (await contract.functions.get_music_art_version!({})).result as { version?: number } | undefined;
  assert.equal(art?.version, 1, "Upgrade publications for flat music pricing before configuring it");
}
console.log(
  JSON.stringify(
    {
      network,
      contract: contract.getId(),
      current: current?.value,
      proposed: policy,
      benchmarkFee: musicFee(8403113, rate_per_mb, flat_fee),
      mode: args.execute ? "execute" : "read-only",
    },
    null,
    2
  )
);
if (
  (current?.value?.flat_fee ?? "0") === flat_fee &&
  current?.value?.recipient === recipient &&
  current.value.rate_per_mb === rate_per_mb &&
  current.value.max_bytes === max_bytes &&
  current.value.enabled === policy.enabled
) {
  console.log("Music policy already matches; no transaction sent.");
} else if (args.execute) {
  const owner = contractSigner(network, "publications", requireSeed(), provider),
    payer = deployerSigner(preset, provider);
  assert.equal(
    owner.getAddress(),
    contract.getId(),
    "Contract seed does not match the deployed publications account"
  );
  contract.signer = owner;
  contract.options = { payer: payer.getAddress() };
  const prepared = await contract.functions.set_music_config!(policy, {
    sendTransaction: false,
    signTransaction: false,
  });
  const result = await submitMeasured(prepared.transaction!, provider, [owner, payer], {
    log: console.log,
  });
  const block = await result.transaction.wait("byBlock", 120000);
  console.log(
    JSON.stringify({ configured: true, txId: result.transaction.id, block, policy }, null, 2)
  );
} else
  console.log(
    "Review this policy, then add --execute to apply it. With no --recipient, fees go to the existing signed Mana sponsor."
  );
