import test from "node:test";
import assert from "node:assert/strict";
import { Signer, signSponsorDiscovery } from "@osp/sdk";
import { ABIS } from "@osp/proto";
import { fixtureDeployment } from "../packages/sdk/src/testing/fixtures.ts";
import { ECONOMY_METHODS, economyReadiness } from "./economy-readiness.ts";
test("activation requires compatible chain-matched indexer, signed sponsor policy and website",async()=>{
  const deployment={...fixtureDeployment(),indexers:["https://indexer.test"],sponsors:["https://sponsor.test"]};
  const signer=Signer.fromSeed("economy-readiness-test-sponsor");
  const unsigned={version:1,sponsor:signer.getAddress(),network:{name:deployment.network,chainId:deployment.chainId,rpc:deployment.rpc},policy:{version:2,allowed:[{contract:deployment.contracts.token.address,entryPoints:ECONOMY_METHODS.map(m=>ABIS.token.methods[m]!.entry_point),methods:[...ECONOMY_METHODS]}],maxBytesPerOp:8192,maxRcPerOp:"200000000",maxOpsPerTx:4,perUser:{dailyOps:200,burstOps:20,burstWindowSec:60}},endpoint:"https://sponsor.test",protocolVersion:1,contracts:Object.fromEntries(Object.entries(deployment.contracts).map(([n,v])=>[n,v.address]))};
  const sponsor=await signSponsorDiscovery(unsigned,signer);
  let indexer={healthy:true,chainId:deployment.chainId,contracts:{token:deployment.contracts.token.address},features:{tokenEconomy:1}};
  let release={tokenEconomy:1}; let discovery=sponsor;
  const fake=async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).includes("/v1/status")?indexer:String(input).includes("release.json")?release:discovery),{status:200});
  assert.equal((await economyReadiness(deployment,"https://site.test",fake)).ready,true);
  indexer={...indexer,features:{tokenEconomy:0}}; assert.equal((await economyReadiness(deployment,"https://site.test",fake)).ready,false);
  indexer={...indexer,features:{tokenEconomy:1},chainId:"wrong"}; assert.equal((await economyReadiness(deployment,"https://site.test",fake)).ready,false);
  indexer={...indexer,chainId:deployment.chainId}; release={tokenEconomy:0}; assert.equal((await economyReadiness(deployment,"https://site.test",fake)).ready,false);
  release={tokenEconomy:1}; discovery={...sponsor,policy:{...sponsor.policy,allowed:[]}}; assert.equal((await economyReadiness(deployment,"https://site.test",fake)).ready,false); // Also invalidates signature.
});
