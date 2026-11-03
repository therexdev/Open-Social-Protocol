import { afterEach, describe, expect, it, vi } from "vitest";
import { ABIS } from "@osp/proto";
import { ProtocolClient, Signer, SponsorClient, encode, toBase64url, NATIVE_TRANSFER_ENTRY, verifySponsorDiscovery, type OperationJson } from "@osp/sdk";
import { createServer } from "./server.js";
import { fakeProvider, fixtureDeployment, injectFetch, testConfig } from "./__tests__/helpers.js";
const deployment = fixtureDeployment(), alice = Signer.fromSeed("wallet alice"), bob = Signer.fromSeed("wallet bob"), sponsor = Signer.fromSeed("wallet sponsor"), native = Signer.fromSeed("native token").getAddress();
const apps: Awaited<ReturnType<typeof createServer>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.close())); });
async function setup(dailyOps = 200) {
  const provider = fakeProvider({ rc: { [alice.getAddress()]: "0", [sponsor.getAddress()]: "1000000000" } });
  provider.invokeGetContractAddress = vi.fn(async () => ({ value: { address: native } })) as never;
  const app = await createServer({ config: testConfig({ dailyOps }), deployment, signer: sponsor, provider });
  apps.push(app);
  await app.sponsorService.initializeWallet();
  const remote = new SponsorClient({ endpoint: "https://sponsor.test", fetch: injectFetch(app) });
  const client = new ProtocolClient({ rpc: provider, deployment, sponsors: [remote] });
  return { app, provider, client, remote };
}
function transfer(from = alice.getAddress(), to = bob.getAddress(), value = "100000001", address = native): OperationJson {
  return { call_contract: { contract_id: address, entry_point: NATIVE_TRANSFER_ENTRY, args: toBase64url(encode("token.transfer_arguments", { from, to, value })) } };
}
describe("sponsored wallet", () => {
  it("uses the platform as payer for native and OSAT transfers without querying sender Mana", async () => {
    const { app, client, provider, remote } = await setup();
    const discovery = await remote.discover();
    expect(verifySponsorDiscovery(discovery).valid).toBe(true);
    expect(discovery.policy.allowed).toContainEqual(expect.objectContaining({ contract: native, entryPoints: [NATIVE_TRANSFER_ENTRY] }));
    expect(app.sponsorService.status().features).toMatchObject({ walletTransfers: 1, musicUploads: 0 });
    for (const operation of [transfer(), await client.ops.token.transfer({ from: alice.getAddress(), to: bob.getAddress(), value: "5" })]) {
      const result = await client.submit({ operations: [operation], signer: alice, selfPayFallback: false });
      expect(result.sponsored).toBe(true);
      expect(result.transaction.header?.payer).toBe(sponsor.getAddress());
      expect(result.transaction.operations).toEqual([operation]);
      expect(await Signer.recoverAddresses(result.transaction)).toContain(alice.getAddress());
    }
    expect(provider.sent).toHaveLength(2);
    expect(app.sponsorService.quota.dailyOps(alice.getAddress())).toBe(2);
  });
  it("refuses another wallet's tokens, mixed bundles, arbitrary token contracts and zero amounts", async () => {
    const { client, provider } = await setup();
    const osat = await client.ops.token.transfer({ from: alice.getAddress(), to: bob.getAddress(), value: "5" });
    const cases = [[transfer(bob.getAddress())], [transfer(), osat], [osat, osat], [transfer(alice.getAddress(),bob.getAddress(),"1",bob.getAddress())], [transfer(alice.getAddress(),bob.getAddress(),"0")], [transfer(alice.getAddress(),alice.getAddress())]];
    for (const operations of cases) await expect(client.submit({ operations, signer: alice, selfPayFallback: false })).rejects.toThrow();
    expect(provider.sent).toHaveLength(0);
  });
  it("keeps transfer sponsorship within normal daily limits and never falls back to user Mana", async () => {
    const { client, provider } = await setup(1);
    await client.submit({ operations: [transfer()], signer: alice, selfPayFallback: false });
    await expect(client.submit({ operations: [transfer()], signer: alice, selfPayFallback: false })).rejects.toMatchObject({ category: "quota_exceeded" });
    expect(provider.sent).toHaveLength(1);
  });
  it("does not allow native approvals outside the existing Music bundle", async () => {
    const { client, provider } = await setup();
    const approval = { call_contract: { ...transfer().call_contract!, entry_point: 0x74e21680 } };
    await expect(client.submit({ operations: [approval], signer: alice, selfPayFallback: false })).rejects.toThrow();
    expect(provider.sent).toHaveLength(0);
  });
});
