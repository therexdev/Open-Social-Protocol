// Read-only check for the Harbinger rollout. The service checks run against local PM2 endpoints by default.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { ProtocolClient, loadDeployment } from "@osp/sdk";
import { networkFromArgs, parseArgs, readDeployment } from "./common.ts";

const args = parseArgs(process.argv.slice(2));
const { name, preset } = networkFromArgs(args);
const deployment = loadDeployment(readDeployment(name));
const client = new ProtocolClient({ deployment, rpc: preset.rpc });
assert((await client.verifyChainId()).ok, "RPC chain differs from the deployment");
const economy = await client.reads.token.get_economy({});
assert(economy?.self_paid_settlement, "Upgrade the Token contract on this chain");
assert.equal(economy.value?.version, 1, "OSAT voting rewards must be active");
console.log(`Token supports automatic settlement · voting period ${economy.value.period_blocks} blocks`);

if (!args["contracts-only"]) {
  const indexer = typeof args.indexer === "string" ? args.indexer : "http://127.0.0.1:8787";
  const sponsor = typeof args.sponsor === "string" ? args.sponsor : "http://127.0.0.1:8788";
  const read = async (base: string, path: string) => {
    const response = await fetch(base.replace(/\/+$/, "") + path, { signal: AbortSignal.timeout(8000) });
    assert(response.ok, `${path} returned HTTP ${response.status}`);
    return response.json();
  };
  const deadline = Date.now() + 120_000;
  while (true) {
    try {
      const index = await read(indexer, "/v1/status");
      assert.equal(index.chainId, deployment.chainId, "Indexer chain mismatch");
      assert.equal(index.contracts?.token, deployment.contracts.token.address, "Indexer Token address mismatch");
      assert.equal(index.features?.rewardSettlementQueue, 1, "Update the indexer");
      assert(index.chainIdMatch && index.healthy, "Waiting for the indexer to catch up");
      const queue = await read(indexer, "/v1/token/settlements/due?limit=1");
      assert(Array.isArray(queue.items), "Indexer did not return a reward queue");
      const health = await read(sponsor, "/healthz");
      assert.equal(health.chainId, deployment.chainId, "Sponsor chain mismatch");
      assert(health.ok, "Sponsor is unavailable");
      const worker = health.rewardSettlement;
      assert(worker?.lastCheckedAt && worker.state === "ready", worker?.lastError ?? `Automatic settlement: ${worker?.state ?? "unavailable"}`);
      const ageMs = Date.now() - Date.parse(worker.lastCheckedAt);
      assert(Number.isFinite(ageMs) && Math.abs(ageMs) < 300_000, "The sponsor has not completed a recent reward check");
      console.log(`Sponsor checked the queue at ${worker.lastCheckedAt}. Latest settlement from this process: ${worker.lastSettledAt ?? "none yet"}.`);
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      console.log(error instanceof Error ? error.message : String(error));
      await delay(5000);
    }
  }
  console.log("AUTOMATIC OSAT READY");
}
