import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ProtocolClient, decode, encode, identityFromSeed, exportIdentity, openEpochKeyFromSet, parseKeyPackageSet } from "@osp/sdk";
import { App } from "../../App";
import { IndexerClient } from "../../api/indexer";
import { useAccount } from "../../stores/account";
import { useSettings } from "../../stores/settings";
import { createVaultStore } from "../../vault/store";
import { memoryStorage } from "../../vault/storage";
import { unsupportedPasskey } from "../../vault/passkey";
import { fakeIndexerFetch, fakeProvider, fixtureDeployment } from "../../testing/fixtures";
import { bytesOf } from "../../util/bytes";

const author = identityFromSeed(new Uint8Array(32).fill(61));
const friend = identityFromSeed(new Uint8Array(32).fill(62));
let root: Root | undefined;
let container: HTMLDivElement;
const previousPayment = useSettings.getState().payment;
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined; container?.remove();
  useAccount.getState().reset(); useSettings.getState().update({ payment: previousPayment });
});

async function setup(registrationOffline: boolean, cachedRecipients: string[] = [author.account], holdHistory = false) {
  const state = { registrationOffline };
  let releaseHistory!: () => void;
  const historyGate = new Promise<void>(resolve => { releaseHistory = resolve; });
  if (!holdHistory) releaseHistory();
  const deployment = fixtureDeployment();
  const provider = fakeProvider({ onRead: op => {
    const method = client.contracts.decodeOperation(op)?.method;
    if (method === "get_identity") {
      const { account } = decode<{ account: string }>("identity.get_identity_arguments", bytesOf(op.args));
      if (account === author.account && state.registrationOffline) throw new Error("Initial identity RPC outage");
      const person = account === author.account ? author : friend;
      return encode("identity.get_identity_result", { value: { account, owner: account, encryption_key: person.encryption.publicKey, key_version: 1 } });
    }
    if (method === "get_relationship") return encode("relationships.get_relationship_result", { value: { a: author.account, b: friend.account, status: 2, nonce: "2" } });
    if (method === "get_audience") return encode("relationships.get_audience_result", { value: { epoch: 1 } });
    return undefined;
  } });
  const client = new ProtocolClient({ deployment, rpc: provider });
  const graph = { account: author.account, friends: [{ account: friend.account, since: "1", nonce: "2" }], pendingIncoming: [], pendingOutgoing: [], followers: [], following: [], blocked: [], audienceEpoch: 1 };
  const indexer = new IndexerClient({ baseUrl: "https://indexer.test", fetch: fakeIndexerFetch({
    [`/v1/profiles/${author.account}`]: () => { if (state.registrationOffline) throw new Error("Initial profile outage"); return { account: author.account, encryptionKey: "", keyVersion: 1 }; },
    [`/v1/profiles/${friend.account}`]: { account: friend.account, encryptionKey: "", keyVersion: 1 },
    [`/v1/graph/${author.account}`]: graph,
    [`/v1/keys/${author.account}`]: async () => { await historyGate; return { items: [] }; },
    [`/v1/notifications/${author.account}`]: { items: [], nextCursor: null },
  }) });
  const vault = createVaultStore({ storage: memoryStorage(), kdf: { N: 1024, r: 8, p: 1 }, passkey: unsupportedPasskey });
  await vault.getState().init(); await vault.getState().importFromFile(exportIdentity({ seed: author.seed, keyVersion: 1, account: author.account }), "test passphrase");
  const epochKey = new Uint8Array(32).fill(70);
  await vault.getState().session!.keys.put({ author: author.account, audienceId: new Uint8Array(), epoch: 0 }, epochKey, { recipients: cachedRecipients });
  useSettings.getState().update({ payment: "self-only" });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter initialEntries={["/friends"]}><App vault={vault} services={resolved => ({ resolved: { ...resolved, deployment, deployed: true, chainId: deployment.chainId }, protocol: client, indexer })} /></MemoryRouter>);
    await new Promise(resolve => setTimeout(resolve, 25));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
  const clickSync = () => act(async () => {
    const button = [...container.querySelectorAll("button")].find(b => b.textContent === "Sync private-post access");
    expect(button).toBeDefined(); button!.click();
    await new Promise(resolve => setTimeout(resolve, 250));
  });
  return { state, provider, client, epochKey, clickSync, releaseHistory };
}

describe("friendship sharing through the real app", () => {
  it("shares the requester's old posts automatically when the app is open", async () => {
    const s = await setup(false);
    expect(s.provider.sent.length, JSON.stringify({ registration: useAccount.getState().registration, visibility: document.visibilityState, ui: container.textContent, reads: s.provider.reads.map(op => s.client.contracts.decodeOperation(op)?.method) })).toBeGreaterThan(0);
    const op = s.client.contracts.decodeOperation(s.provider.sent[0]!.transaction.operations![0]!)!;
    expect(openEpochKeyFromSet(parseKeyPackageSet(op.args.packages as Uint8Array), friend.account, friend.encryption.secretKey)).toEqual(s.epochKey);
  });

  it("does not leave manual sharing inert after registration lookup failed during unlock", async () => {
    const s = await setup(true);
    expect(useAccount.getState().registration).toBe("unavailable");
    s.state.registrationOffline = false;
    await s.clickSync();
    expect(s.provider.sent.length).toBeGreaterThan(0);
  });

  it("manual repair resends access even when an older cache incorrectly says the friend received it", async () => {
    const s = await setup(false, [author.account, friend.account]);
    expect(s.provider.sent).toHaveLength(0);
    await s.clickSync();
    expect(s.provider.sent.length).toBeGreaterThan(0);
    expect(container.textContent).toContain("deliveries confirmed");
  });

  it("queues a repair pressed during background sharing instead of dropping the click", async () => {
    const s = await setup(false, [author.account], true);
    expect(s.provider.sent).toHaveLength(0);
    await s.clickSync();
    await act(async () => { s.releaseHistory(); await new Promise(resolve => setTimeout(resolve, 250)); });
    expect(s.provider.sent).toHaveLength(2);
    expect(container.textContent).toContain("deliveries confirmed");
  });
});
