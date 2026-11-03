// Read-only verification after restarting the sponsor; no deployment keys required.
import assert from "node:assert/strict";
import { ABIS } from "@osp/proto";
import { ProtocolClient, loadDeployment, resolveNativeToken, NATIVE_TRANSFER_ENTRY, verifySponsorDiscovery, type SponsorDiscovery } from "@osp/sdk";
import { networkFromArgs, parseArgs, readDeployment } from "./common.ts";
const { name: network } = networkFromArgs(parseArgs(process.argv.slice(2)));
const deployment = loadDeployment(readDeployment(network));
const client = new ProtocolClient({ deployment });
const native = await resolveNativeToken(client);
const endpoint = deployment.sponsors?.[0];
assert(endpoint, "No platform sponsor is configured");
const json = async (path: string) => {
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}${path}`, { signal: AbortSignal.timeout(20000) });
  assert(response.ok, `Sponsor HTTP ${response.status}`);
  return response.json();
};
const discovery = await json("/.well-known/osp-sponsor.json") as SponsorDiscovery;
const health = await json("/healthz");
assert(verifySponsorDiscovery(discovery).valid, "Invalid sponsor discovery signature");
assert.equal(discovery.network.chainId, deployment.chainId, "Sponsor network mismatch");
assert.equal(health.features?.walletTransfers, 1, "Restart the updated sponsor with the default platform allowlist");
const registered = (await client.reads.sponsorship.get_sponsor({ sponsor: discovery.sponsor }))?.value;
assert(registered?.active, "Sponsor registration is not active");
for (const [contract, entry] of [[native, NATIVE_TRANSFER_ENTRY], [deployment.contracts.token.address, ABIS.token.methods.transfer!.entry_point]] as const) {
  assert(discovery.policy.allowed.some(a => a.contract === contract && a.entryPoints.includes(entry)), `Sponsor does not cover ${contract} transfers`);
  assert(registered.allowed.some(a => a.contract_id === contract && a.entry_points.includes(entry)), "Sponsor must refresh its on-chain transfer policy");
}
console.log(`WALLET READY — OSAT and ${network === "mainnet" ? "KOIN" : "tKOIN"} transfers are covered by sponsor ${discovery.sponsor}.`);
