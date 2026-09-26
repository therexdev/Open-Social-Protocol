import assert from "node:assert/strict";
import { Contract } from "koilib";
import { ABIS } from "@osp/proto";
import { loadDeployment } from "@osp/sdk";
import { contractSigner, deployerSigner, networkFromArgs, parseArgs, providerFor, readDeployment, requireSeed } from "./common.ts";
import { submitMeasured } from "./deployment-transactions.ts";
import { economyReadiness } from "./economy-readiness.ts";
const args=parseArgs(process.argv.slice(2)),{name:network,preset}=networkFromArgs(args);
assert.equal(network,"harbinger","This pilot is Harbinger-only");
const deployment=loadDeployment(readDeployment(network)),provider=providerFor(preset);
assert.equal(await provider.getChainId(),deployment.chainId,"Wrong chain");
const contract=new Contract({id:deployment.contracts.token.address,abi:ABIS.token as never,provider});
const current=(await contract.functions.get_economy!({})).result as {value?:{version?:number}}|undefined;
if(current?.value?.version){
  console.log("Economy is already activated; no transaction submitted.");
}else{
  const readiness=await economyReadiness(deployment,typeof args.site==="string"?args.site:undefined);
  console.log(JSON.stringify(readiness,null,2));
  if(!readiness.ready){
    if(!args["if-ready"]) process.exitCode=1;
  }else if(args.execute){
    const owner=contractSigner(network,"token",requireSeed(),provider),payer=deployerSigner(preset,provider);
    assert.equal(owner.getAddress(),deployment.contracts.token.address);
    contract.signer=owner; contract.options={payer:payer.getAddress()};
    // Empty arguments always select the five-day public period, never rehearsal timing.
    const prepared=await contract.functions.activate_economy!({}, {sendTransaction:false,signTransaction:false});
    const result=await submitMeasured(prepared.transaction!,provider,[owner,payer],{log:console.log});
    const block=await result.transaction.wait("byBlock",120000);
    const policy=(await contract.functions.get_economy!({})).result;
    console.log(JSON.stringify({activated:true,txId:result.transaction.id,block,policy},null,2));
  }else console.log("Readiness passed. Run with --execute to activate.");
}
