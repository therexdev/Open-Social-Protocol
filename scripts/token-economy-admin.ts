/** Explicit tester allocations; recipients and amounts are always supplied by the operator. */
import assert from "node:assert/strict";
import { loadDeployment, ProtocolClient, isAddress } from "@osp/sdk";
import { contractSigner, deployerSigner, networkFromArgs, parseArgs, providerFor, readDeployment, requireSeed } from "./common.ts";
import { submitMeasured } from "./deployment-transactions.ts";
const args=parseArgs(process.argv.slice(2)),{name:network,preset}=networkFromArgs(args);
assert.equal(network,"harbinger");assert(args.execute && typeof args.grant==="string","Use --execute --grant address:amount[,address:amount]");
const grants=args.grant.split(",").map(entry=>{const [account,value,...rest]=entry.split(":");assert(account&&isAddress(account)&&value&&/^[1-9]\d{0,2}$/.test(value)&&BigInt(value)<=100n&&!rest.length,"Each grant must be a valid account and 1–100 whole tokens");return {account,value};});
assert(grants.length<=50,"At most 50 explicit recipients per invocation");assert.equal(new Set(grants.map(g=>g.account)).size,grants.length,"Duplicate recipients");
const provider=providerFor(preset),deployment=loadDeployment(readDeployment(network));assert.equal(await provider.getChainId(),deployment.chainId);
const owner=contractSigner(network,"token",requireSeed(),provider),payer=deployerSigner(preset,provider);assert.equal(owner.getAddress(),deployment.contracts.token.address);
const client=new ProtocolClient({rpc:provider,deployment});
assert.equal((await client.reads.token.get_economy({}))?.value?.version,1,"Activate the economy after readiness passes first");
for(const grant of grants){
  const prepared=await client.prepare([await client.ops.token.grant_test_tokens(grant)],{payer:payer.getAddress(),payee:owner.getAddress()});
  const result=await submitMeasured(prepared,provider,[owner,payer],{log:console.log});await result.transaction.wait("byTransactionId",120000);
  console.log(JSON.stringify({account:grant.account,value:grant.value,txId:result.transaction.id}));
}
