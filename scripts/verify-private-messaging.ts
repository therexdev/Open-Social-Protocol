// Read-only readiness checks. Never reserves usage, signs, or broadcasts a transaction.
import assert from "node:assert/strict";
import { Contract, Provider } from "koilib";
import { ABIS } from "@osp/proto";
import { SponsorClient } from "@osp/sdk";
import { networkFromArgs, parseArgs, readDeployment } from "./common.ts";

const args = parseArgs(process.argv.slice(2));
const { name: network } = networkFromArgs(args);
const deployment = readDeployment(network);
if (!deployment?.contracts.messaging) throw new Error("Messaging deployment is missing");
const messaging = deployment.contracts.messaging.address;
const indexer = String(args.indexer ?? deployment.indexers?.[0] ?? "https://social-api.usekoinos.com").replace(/\/$/, "");
const endpoint = String(args.sponsor ?? deployment.sponsors?.[0] ?? "https://social-sponsor.usekoinos.com").replace(/\/$/, "");
const provider = new Provider(deployment.rpc);
const timer = setTimeout(() => { console.error("Readiness checks timed out"); process.exit(1); }, 45_000);
timer.unref();
async function json(url: string): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  assert(response.ok, `${url}: HTTP ${response.status}`);
  return response.json();
}
const checks: Array<[string, () => Promise<void>]> = [
  ["on-chain private messaging v2", async () => {
    assert.equal(await provider.getChainId(), deployment.chainId, "wrong RPC chain");
    const contract = new Contract({ id: messaging, abi: ABIS.messaging as never, provider });
    const { result } = await contract.functions.get_private_status!({});
    assert.equal(Number((result as any)?.version), 2, "upgrade messaging contract first");
  }],
  ["indexer v2 and shared invitation log", async () => {
    const status = await json(`${indexer}/v1/status`);
    assert.equal(status.chainId, deployment.chainId, "wrong indexer chain");
    assert.equal(status.contracts.messaging, messaging, "wrong messaging address");
    assert.equal(status.features?.privateMessaging, 2, "upgrade indexer first");
    assert.equal(status.healthy, true, "indexer is not caught up/healthy");
    const page = await json(`${indexer}/v2/private/packets?after=0&limit=1`);
    assert(Array.isArray(page.items), "missing shared invitation log");
  }],
  ["sponsor v2 and private method policy", async () => {
    const health = await json(`${endpoint}/healthz`);
    assert.equal(health.ok, true);
    assert.equal(health.features?.privateMessaging, 2, "upgrade sponsor first");
    const doc = await new SponsorClient({ endpoint, expectedChainId: deployment.chainId }).discover();
    const allowed = doc.policy.allowed.find(a => a.contract === messaging)?.entryPoints ?? [];
    for (const method of ["set_private_device", "reserve_private_usage", "open_private_channel", "close_private_channel", "post_private_packet"]) {
      assert(allowed.includes(ABIS.messaging.methods[method]!.entry_point), `sponsor must allow ${method}`);
    }
    assert(!allowed.includes(ABIS.messaging.methods.allocate_private_usage!.entry_point), "allocation is sponsor-internal, not caller-supplied");
  }],
];
let failures = 0;
await Promise.all(checks.map(async ([label, check]) => {
  try { await check(); console.log(`PASS ${label}`); }
  catch (error) { failures++; console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`); }
}));
clearTimeout(timer);
if (failures) process.exitCode = 1;
else console.log("Infrastructure ready. Complete the two-browser acceptance test in docs/private-messaging-v2.md before inviting testers.");
