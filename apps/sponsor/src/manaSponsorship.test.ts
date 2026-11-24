import { afterEach, expect, it } from "vitest";
import { ProtocolClient, Signer, SponsorClient, signPrivateStatement, encode, toBase64url, type OperationJson } from "@osp/sdk";
import { ABIS } from "@osp/proto";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { fakeProvider, fixtureDeployment, injectFetch, nonceValue, testConfig } from "./__tests__/helpers.js";

const owner = Signer.fromSeed("mana-owner"), device = Signer.fromSeed("mana-device"), payer = Signer.fromSeed("mana-payer");
const other = Signer.fromSeed("mana-other"), alias1 = Signer.fromSeed("mana-alias-1"), alias2 = Signer.fromSeed("mana-alias-2");
const account = owner.getAddress(), now = Date.parse("2026-11-23T12:00:00Z"), half = "2500000000";
const apps: Awaited<ReturnType<typeof createServer>>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
async function harness() {
  let currentOwner = account, deviceAllowed = true;
  const deployment = { ...fixtureDeployment(), economy: "token-free" as const };
  const provider = fakeProvider({ rc:{ [payer.getAddress()]:"1000000000000" }, onRead: op => {
    if (op.entry_point === ABIS.identity.methods.get_identity!.entry_point)
      return encode("identity.get_identity_result", { value:{ account, owner:currentOwner } });
    if (op.entry_point === ABIS.identity.methods.resolve_actor!.entry_point)
      return encode("identity.resolve_actor_result", { ok:deviceAllowed, signer:device.getAddress() });
    return undefined;
  }});
  provider.getHeadInfo = async () => ({ head_block_time:String(now), head_topology:{ id:"head", height:"100", previous:"previous" },
    head_state_merkle_root:"root", last_irreversible_block:"90" });
  const app = await createServer({ deployment, signer:payer, provider, now:() => now,
    config:testConfig({ dailyManaRc:"5000000000", dailyOps:Number.MAX_SAFE_INTEGER, maxRcPerOp:half, autoSettleRewards:false }) });
  apps.push(app);
  const client = new ProtocolClient({ deployment, rpc:provider });
  let nonce = 0;
  const tx = async (operations: OperationJson[], signer = owner) => client.sign(await client.prepare(operations,
    { payer:payer.getAddress(), payee:signer.getAddress(), rcLimit:half, nonce:nonceValue(++nonce) }),signer);
  const react = (d?: Signer) => client.ops.publications.react({ actor:account, post_id:new Uint8Array(32).fill(1), reaction:1, ...(d && { device:d.getAddress() }) });
  return { app, provider, client, tx, react, service:app.sponsorService,
    rotate:(next:string) => { currentOwner=next; }, revoke:() => { deviceAllowed=false; } };
}
it("shares one allowance across owner and device and keeps mempool estimates reserved", async () => {
  const h=await harness();
  await h.service.sponsor(await h.tx([await h.react()]));
  expect(h.service.mana!.allowance(account,now)).toMatchObject({ remainingRc:half, reservedRc:half, usedRc:"0" });
  await h.service.sponsor(await h.tx([await h.react(device)],device));
  await expect(h.service.sponsor(await h.tx([await h.react()]))).rejects.toThrow("allowance exhausted");
  expect(h.provider.sent).toHaveLength(2);
});
it("keeps the same account budget across recovery and refuses an old owner or revoked device", async () => {
  const h=await harness(); await h.service.sponsor(await h.tx([await h.react()]));
  h.rotate(other.getAddress());
  await h.service.sponsor(await h.tx([await h.react()],other));
  expect(h.service.mana!.allowance(account,now).remainingRc).toBe("0");
  await expect(h.service.sponsor(await h.tx([await h.react()]))).rejects.toThrow("current account owner");
  h.revoke(); await expect(h.service.sponsor(await h.tx([await h.react(device)],device))).rejects.toThrow("not authorized");
});
it("charges different private aliases to their parent, requires attribution and rejects stale recovery ownership", async () => {
  const h=await harness();
  const packet = (alias:Signer) => h.client.ops.messaging.post_private_packet({ actor:alias.getAddress(), packet_id:new Uint8Array(32).fill(1), envelope:new Uint8Array(44).fill(1) });
  await expect(h.service.sponsor(await h.tx([await packet(alias1)],alias1))).rejects.toThrow("authenticated allowance allocation");
  h.service.mana!.bindAlias(alias1.getAddress(),account,account); h.service.mana!.bindAlias(alias2.getAddress(),account,account);
  await h.service.sponsor(await h.tx([await packet(alias1)],alias1));
  await h.service.sponsor(await h.tx([await packet(alias2)],alias2));
  expect(h.service.mana!.allowance(account,now).remainingRc).toBe("0");
  h.rotate(other.getAddress());
  await expect(h.service.sponsor(await h.tx([await packet(alias1)],alias1))).rejects.toThrow("after account recovery");
});
it("returns an unknown outcome on transport failure, keeps maximum liability and rejects duplicate submission", async () => {
  const h=await harness(), signed=await h.tx([await h.react()]);
  h.provider.sendTransaction = async () => { throw new Error("connection lost after send"); };
  const client = new SponsorClient({ endpoint:"https://sponsor.test",fetch:injectFetch(h.app),expectedChainId:h.client.chainId });
  const discovery=await client.discover();
  expect(discovery.policy.perUser).toMatchObject({ dailyRc:"5000000000",reset:"utc-calendar-day" });
  const result=await client.sponsor(signed);
  expect(result.receipt.rpc_error).toBeTruthy();
  expect(h.service.mana!.allowance(account,now).reservedRc).toBe(half);
  await expect(h.service.sponsor(signed)).rejects.toThrow("already submitted");
});
it("does not allow a batch to distribute liability over multiple identities", async () => {
  const h=await harness();
  const second=await h.client.ops.publications.react({ actor:other.getAddress(),post_id:new Uint8Array(32),reaction:1 });
  await expect(h.service.sponsor(await h.tx([await h.react(),second]))).rejects.toThrow("One protocol account");
  expect(h.provider.sent).toHaveLength(0);
});

it("protects private allowance reads with an expiring current-owner proof", async () => {
  const h=await harness(); await h.service.sponsor(await h.tx([await h.react()]));
  const payload={account,signer:account,endpoint:"https://sponsor.test",expiresAt:now+60000};
  const scope={chainId:h.client.chainId,contract:h.client.deployment.contracts.identity.address};
  const signature=await signPrivateStatement(scope,"mana-allowance",payload,owner);
  expect(await h.service.manaAllowance({...payload,signature})).toMatchObject({remainingRc:half,reservedRc:half});
  await expect(h.service.manaAllowance({...payload,expiresAt:now-1,signature})).rejects.toThrow("Invalid allowance proof");
  await expect(h.service.manaAllowance({...payload,signer:other.getAddress(),signature})).rejects.toThrow("Invalid allowance signature");
});

it("defaults mainnet to 50 Mana with no daily action gate and allows a persistent 25-Mana policy", () => {
  expect(loadConfig({OSP_NETWORK:"mainnet"})).toMatchObject({dailyManaRc:"5000000000",dailyOps:Number.MAX_SAFE_INTEGER,autoSettleRewards:false});
  expect(loadConfig({OSP_NETWORK:"mainnet",OSP_SPONSOR_DAILY_MANA:"25"}).dailyManaRc).toBe("2500000000");
  expect(() => loadConfig({OSP_NETWORK:"mainnet",OSP_SPONSOR_DAILY_MANA:"0"})).toThrow("requires a daily Mana");
  expect(loadConfig({OSP_NETWORK:"harbinger"}).dailyManaRc).toBeUndefined();
});

it("refuses a depleted shared pool during preparation without charging the account", async () => {
  const h=await harness(); h.provider.getAccountRc=async () => "0";
  await expect(h.service.prepare(account,[await h.react()])).rejects.toThrow("pool is busy or depleted");
  expect(h.service.mana!.allowance(account,now).reservedRc).toBe("0");
});
it("charges the authenticated parent for a private allocation and keeps its proof off chain", async () => {
  const h=await harness(), reservationId=toBase64url(new Uint8Array(32).fill(7));
  const read=h.provider.readContract.bind(h.provider);
  h.provider.readContract=async op => op.entry_point===ABIS.messaging.methods.get_private_reservation!.entry_point
    ? {result:toBase64url(encode("messaging.get_private_reservation_result",{value:{account,sponsor:payer.getAddress(),reservation_id:new Uint8Array(32).fill(7),units:4,block:"80"}})),logs:""}
    : read(op);
  const scope={chainId:h.client.chainId,contract:h.client.deployment.contracts.messaging.address};
  const payload={reservationId,actor:alias1.getAddress()};
  const signature=await signPrivateStatement(scope,"allocate",payload,owner);
  await h.service.allocatePrivateUsage({...payload,signature});
  expect(h.service.mana!.allowance(account,now).reservedRc).toBe(half);
  expect(h.service.mana!.aliasAccount(alias1.getAddress())).toBe(account);
  const op=h.client.contracts.decodeOperation(h.provider.sent[0]!.transaction.operations![0]!);
  expect(op?.method).toBe("allocate_private_usage");
  expect(op?.args).not.toHaveProperty("account"); expect(op?.args).not.toHaveProperty("reservation_id");
});
