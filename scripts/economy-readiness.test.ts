import test from "node:test";
import assert from "node:assert/strict";
import { Signer, signSponsorDiscovery, type SponsorRecord } from "@osp/sdk";
import { ABIS } from "@osp/proto";
import { fixtureDeployment } from "../packages/sdk/src/testing/fixtures.ts";
import { ECONOMY_METHODS, economyReadiness } from "./economy-readiness.ts";
test("activation requires compatible chain-matched indexer, signed sponsor policy and website",async()=>{
  const deployment={...fixtureDeployment(),indexers:["https://indexer.test"],sponsors:["https://sponsor.test"]};
  const signer=Signer.fromSeed("economy-readiness-test-sponsor");
  const unsigned={version:1,sponsor:signer.getAddress(),network:{name:deployment.network,chainId:deployment.chainId,rpc:deployment.rpc},policy:{version:2,allowed:[{contract:deployment.contracts.token.address,entryPoints:ECONOMY_METHODS.map(m=>ABIS.token.methods[m]!.entry_point),methods:[...ECONOMY_METHODS]}],maxBytesPerOp:8192,maxRcPerOp:"200000000",maxOpsPerTx:4,perUser:{dailyOps:200,burstOps:20,burstWindowSec:60}},endpoint:"https://sponsor.test",protocolVersion:1,contracts:Object.fromEntries(Object.entries(deployment.contracts).map(([n,v])=>[n,v.address]))};
  const sponsor=await signSponsorDiscovery(unsigned,signer);
  const registered: SponsorRecord = {
    sponsor: signer.getAddress(), endpoint: unsigned.endpoint,
    policy_uri: `${unsigned.endpoint}/.well-known/osp-sponsor.json`, policy_version: 2,
    allowed: unsigned.policy.allowed.map(entry => ({contract_id:entry.contract,entry_points:entry.entryPoints})),
    max_rc_per_op: unsigned.policy.maxRcPerOp, max_ops_per_user_per_day: 200,
    max_bytes_per_op: 8192, active: true, registered_at: "1", updated_at: "1",
  };
  let record: SponsorRecord | undefined = registered;
  let registryUnavailable = false;
  const readSponsor = async(address:string) => {
    assert.equal(address, signer.getAddress());
    if (registryUnavailable) throw new Error("RPC unavailable");
    return record;
  };
  let indexer={healthy:true,chainId:deployment.chainId,contracts:{token:deployment.contracts.token.address},features:{tokenEconomy:1}};
  let release={tokenEconomy:1}; let discovery=sponsor;
  const fake=async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).includes("/v1/status")?indexer:String(input).includes("release.json")?release:discovery),{status:200});
  const ready = async()=> (await economyReadiness(deployment,"https://site.test",fake,readSponsor)).ready;
  assert.equal(await ready(),true);
  for (const missingOrStale of [undefined, {...registered,active:false}, {...registered,policy_version:1}, {...registered,allowed:[]}, {...registered,endpoint:"https://old.test"}, {...registered,max_rc_per_op:"1"}]) {
    record = missingOrStale;
    assert.equal(await ready(),false,"signed HTTP discovery alone must never pass the registration gate");
  }
  record = registered;
  registryUnavailable = true; assert.equal(await ready(),false);
  registryUnavailable = false; assert.equal(await ready(),true);
  indexer={...indexer,features:{tokenEconomy:0}}; assert.equal(await ready(),false);
  indexer={...indexer,features:{tokenEconomy:1},chainId:"wrong"}; assert.equal(await ready(),false);
  indexer={...indexer,chainId:deployment.chainId}; release={tokenEconomy:0}; assert.equal(await ready(),false);
  release={tokenEconomy:1}; discovery={...sponsor,policy:{...sponsor.policy,allowed:[]}}; assert.equal(await ready(),false); // Also invalidates signature.
});
