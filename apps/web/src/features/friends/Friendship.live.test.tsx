/** Opt-in real-network App regression. Uses disposable identities only.
 * OSP_LIVE_UI_CHECKPOINT=/absolute/private-test.json npm test -w @osp/web -- Friendship.live.test.tsx
 * The checkpoint contains test seeds and must never be committed or uploaded.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "koilib";
import { ProtocolClient, identityFromSeed, exportIdentity, randomBytes, toBase64url, fromBase64url, type Deployment, type Identity } from "@osp/sdk";
import { App } from "../../App";
import { IndexerClient } from "../../api/indexer";
import { useAccount } from "../../stores/account";
import { useSettings } from "../../stores/settings";
import { useToasts } from "../../stores/toasts";
import { createVaultStore, type VaultStore } from "../../vault/store";
import { memoryStorage } from "../../vault/storage";
import { unsupportedPasskey } from "../../vault/passkey";

const checkpoint = process.env.OSP_LIVE_UI_CHECKPOINT;
const restoreCheckpoint = process.env.OSP_LIVE_UI_RESTORE;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container?.remove(); });

it.skipIf(!checkpoint)("real App: both request directions, removal, retained old access, excluded new posts and re-acceptance", async () => {
  expect(checkpoint?.startsWith("/")).toBe(true);
  expect(existsSync(checkpoint!)).toBe(false); // Never replay transactions from an interrupted run blindly.
  const deployment = JSON.parse(readFileSync(resolve("../../deployments/harbinger.json"), "utf8")) as Deployment;
  expect(deployment.network).toBe("harbinger");
  const provider = new Provider(deployment.rpc);
  const rpcCall = provider.call.bind(provider);
  provider.call = async <T,>(method: string, params: unknown): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try { return await rpcCall<T>(method, params); }
      catch (error) { if (method === "chain.submit_transaction" || attempt >= 2) throw error; }
    }
  };
  const client = new ProtocolClient({ deployment, rpc: provider, sponsors: ["https://social-sponsor.usekoinos.com"] });
  const indexer = new IndexerClient({ baseUrl: "https://social-api.usekoinos.com" });
  const identities = [identityFromSeed(randomBytes(32)), identityFromSeed(randomBytes(32))];
  const results: Array<{ name: string; at: string }> = [];
  const transactions: string[] = [];
  const save = () => writeFileSync(checkpoint!, JSON.stringify({ seeds: identities.map(i => toBase64url(i.seed)), accounts: identities.map(i => i.account), results, transactions }, null, 2), { mode: 0o600 });
  save();
  const send = provider.sendTransaction.bind(provider);
  provider.sendTransaction = async (...args) => {
    const result = await send(...args);
    if (args[1] !== false && args[0].id) { transactions.push(args[0].id); save(); }
    return result;
  };
  const pass = (name: string) => {
    for (const toast of useToasts.getState().toasts) for (const detail of toast.details ?? []) {
      const id = /^Transaction (0x[0-9a-f]+)$/.exec(detail)?.[1];
      if (id && !transactions.includes(id)) transactions.push(id);
    }
    results.push({ name, at: new Date().toISOString() }); save(); console.log("PASS", name); };
  console.log("RUN verify live chain");
  expect(await provider.getChainId()).toBe(deployment.chainId);
  const vaults: VaultStore[] = [];
  for (const me of identities) {
    console.log("RUN register disposable account", me.account);
    await client.submit({ operations: [await client.ops.identity.register({ account: me.account, encryption_key: me.encryption.publicKey, key_version: 1 })], signer: me.signer, selfPayFallback: false, waitForReceipt: true });
    const vault = createVaultStore({ storage: memoryStorage(), kdf: { N: 1024, r: 8, p: 1 }, passkey: unsupportedPasskey });
    await vault.getState().init();
    await vault.getState().importFromFile(exportIdentity({ seed: me.seed, keyVersion: 1, account: me.account }), "disposable test passphrase");
    vaults.push(vault);
  }
  useSettings.getState().update({ network: "harbinger", payment: "sponsor-only", autoLockMinutes: 60 });
  const wait = async (description: string, ready: () => boolean | Promise<boolean>, timeout = 90_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await ready()) return;
      await act(async () => { await new Promise(r => setTimeout(r, 250)); });
    }
    throw new Error(`Timed out: ${description}. UI: ${container?.textContent}`);
  };
  const mount = async (i: number, route: string) => {
    // Do not cancel a transaction in progress when changing the simulated browser account.
    if (container) await wait("sharing finished before navigation", () => !container!.querySelector('[aria-live="polite"][aria-busy="true"]'));
    await act(async () => root?.unmount()); container?.remove();
    useAccount.getState().reset();
    useToasts.getState().clear();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root!.render(<MemoryRouter initialEntries={[route]}><App vault={vaults[i]!} services={resolved => ({ resolved: { ...resolved, deployment, deployed: true, chainId: deployment.chainId, indexerUrl: "https://social-api.usekoinos.com", sponsorUrls: ["https://social-sponsor.usekoinos.com"] }, protocol: client, indexer })} /></MemoryRouter>));
    await wait("registered account", () => useAccount.getState().registration === "registered");
  };
  const button = (label: string, dialog = false) => [...(container?.querySelectorAll<HTMLButtonElement>(dialog ? 'dialog button' : "button") ?? [])].find(b => b.textContent?.trim() === label && !b.disabled);
  const click = async (label: string, dialog = false) => {
    await wait(`button ${label}`, () => !!button(label, dialog));
    await act(async () => button(label, dialog)!.click());
  };
  const postText = (text: string) => [...(container?.querySelectorAll(".post-text") ?? [])].some(p => p.textContent === text);
  const publish = async (i: number, text: string) => {
    await mount(i, "/compose");
    await act(async () => {
      const textarea = container!.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      container!.querySelector<HTMLInputElement>('input[name="audience"][value="1"]')!.click();
    });
    await click("Review and publish");
    await click("Publish to Friends", true);
    await wait("published content rendered", () => postText(text));
    pass(`UI published: ${text}`);
  };
  const graphHas = async (i: number, kind: "friends" | "pendingIncoming", peer: Identity) => (await indexer.graph(identities[i]!.account))[kind].some(f => f.account === peer.account);
  const request = async (i: number, j: number) => {
    await mount(i, `/u/${identities[j]!.account}`);
    await click("Add friend");
    await wait("incoming request indexed", () => graphHas(j, "pendingIncoming", identities[i]!));
    pass(`UI request ${i} to ${j}`);
  };
  const accept = async (i: number, j: number) => {
    await mount(i, `/u/${identities[j]!.account}`);
    await click("Accept request");
    await wait("friendship indexed both directions", async () => await graphHas(i, "friends", identities[j]!) && await graphHas(j, "friends", identities[i]!));
    await wait("acceptance transaction confirmed", () => !button("Accept request"));
    pass(`UI accept ${i} from ${j}`);
  };
  const read = async (i: number, j: number, text: string, readable: boolean) => {
    await mount(i, `/u/${identities[j]!.account}`);
    if (readable) await wait(`reader ${i} opens ${text}`, () => postText(text));
    else {
      await wait("encrypted post settled", () => !!container!.querySelector(".post-state")?.textContent?.includes("do not have the key"));
      expect(postText(text)).toBe(false);
    }
    pass(`UI ${i} ${readable ? "reads" : "cannot read"}: ${text}`);
  };
  const old = ["UI audit A original", "UI audit B original"];
  const removed = ["UI audit A while removed", "UI audit B while removed"];
  await publish(0, old[0]!); await publish(1, old[1]!);
  await read(0, 1, old[1]!, false); await read(1, 0, old[0]!, false);
  await request(0, 1); await accept(1, 0);
  // Opening the original requester must deliver its keys without publishing or pressing Sync.
  await read(0, 1, old[1]!, true); await read(1, 0, old[0]!, true);
  await mount(1, `/u/${identities[0]!.account}`);
  await click("Remove friend"); await click("Remove friend", true);
  await wait("removal indexed", async () => !(await graphHas(0, "friends", identities[1]!)) && !(await graphHas(1, "friends", identities[0]!)));
  pass("UI removed by original acceptor");
  await read(0, 1, old[1]!, true); await read(1, 0, old[0]!, true);
  await publish(0, removed[0]!); await publish(1, removed[1]!);
  await read(0, 1, removed[1]!, false); await read(1, 0, removed[0]!, false);
  await request(1, 0); await accept(0, 1);
  await read(1, 0, removed[0]!, true); await read(0, 1, removed[1]!, true);
  await read(0, 1, old[1]!, true); await read(1, 0, old[0]!, true);
  // Restore from the same seed into empty encrypted stores: no cached reading keys.
  for (let i = 0; i < 2; i++) {
    const me = identities[i]!;
    const restored = createVaultStore({ storage: memoryStorage(), kdf: { N: 1024, r: 8, p: 1 }, passkey: unsupportedPasskey });
    await restored.getState().init();
    await restored.getState().importFromFile(exportIdentity({ seed: me.seed, keyVersion: 1, account: me.account }), "disposable test passphrase");
    vaults[i] = restored;
    await read(i, 1 - i, old[1 - i]!, true);
    await read(i, 1 - i, removed[1 - i]!, true);
  }
  pass("cold restores recover both directions of old and newer private posts");
}, 1_200_000);

// Resume only the read/restore checks from an interrupted journey, without replaying
// friendship mutations or publications. Deliberately fail one first profile fetch.
it.skipIf(!restoreCheckpoint)("live App cold restore recovers after an initial profile outage", async () => {
  const state = JSON.parse(readFileSync(restoreCheckpoint!, "utf8"));
  const deployment = JSON.parse(readFileSync(resolve("../../deployments/harbinger.json"), "utf8")) as Deployment;
  expect(deployment.network).toBe("harbinger");
  const provider = new Provider(deployment.rpc);
  const client = new ProtocolClient({ deployment, rpc: provider, sponsors: ["https://social-sponsor.usekoinos.com"] });
  const identities = state.seeds.map((s: string) => identityFromSeed(fromBase64url(s))) as Identity[];
  useSettings.getState().update({ network: "harbinger", payment: "sponsor-only", autoLockMinutes: 60 });
  state.restoreResults = [];
  const save = (name: string) => {
    state.restoreResults.push({ name, at: new Date().toISOString() });
    writeFileSync(restoreCheckpoint!, JSON.stringify(state, null, 2), { mode: 0o600 });
  };
  for (let i = 0; i < 2; i++) {
    const me = identities[i]!, peer = identities[1 - i]!;
    let failProfilePosts = true;
    const indexer = new IndexerClient({ baseUrl: "https://social-api.usekoinos.com", fetch: async (url, init) => {
      if (failProfilePosts && new URL(url).pathname === `/v1/accounts/${peer.account}/posts`) {
        failProfilePosts = false;
        throw new Error("Injected initial profile outage");
      }
      return fetch(url, init);
    } });
    const vault = createVaultStore({ storage: memoryStorage(), kdf: { N: 1024, r: 8, p: 1 }, passkey: unsupportedPasskey });
    await vault.getState().init();
    await vault.getState().importFromFile(exportIdentity({ seed: me.seed, keyVersion: 1, account: me.account }), "disposable test passphrase");
    expect(vault.getState().session!.keys.size).toBe(0);
    await act(async () => root?.unmount()); container?.remove(); useAccount.getState().reset();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root!.render(<MemoryRouter initialEntries={[`/u/${peer.account}`]}><App vault={vault} services={resolved => ({ resolved: { ...resolved, deployment, deployed: true, chainId: deployment.chainId, indexerUrl: indexer.baseUrl, sponsorUrls: ["https://social-sponsor.usekoinos.com"] }, protocol: client, indexer })} /></MemoryRouter>));
    const end = Date.now() + 120_000;
    const expected = [i === 0 ? "UI audit B original" : "UI audit A original", i === 0 ? "UI audit B while removed" : "UI audit A while removed"];
    while (Date.now() < end && !expected.every(text => [...container!.querySelectorAll(".post-text")].some(p => p.textContent === text))) {
      await act(async () => { await new Promise(r => setTimeout(r, 250)); });
    }
    for (const text of expected) {
      expect([...container!.querySelectorAll(".post-text")].some(p => p.textContent === text), container!.textContent ?? "").toBe(true);
      save(`Cold restored ${i} reads after profile outage: ${text}`);
    }
  }
}, 300_000);
