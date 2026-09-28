/** Opt-in live private-messaging journey. Uses new disposable TEST identities only.
 * node --import tsx scripts/test-private-messaging-testnet.ts --execute
 * Never pass a user's seed. No private material is printed or written by this script.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { ProtocolClient, Provider, identityFromSeed, randomBytes, loadDeployment } from "@osp/sdk";
import { IndexerClient } from "../apps/web/src/api/indexer.ts";
import { PrivateStore, type ExclusiveLock } from "../apps/web/src/features/messages/privateStore.ts";
import { PrivateMessagingService, type PrivateSnapshot } from "../apps/web/src/features/messages/privateService.ts";
import { memoryStorage } from "../apps/web/src/vault/storage.ts";
import { useToasts } from "../apps/web/src/stores/toasts.ts";
assert.equal(process.argv[2], "--execute", "Explicit --execute required; this test submits testnet transactions");
const deployment = loadDeployment(readFileSync(new URL("../deployments/harbinger.json", import.meta.url), "utf8"));
assert.equal(deployment.network, "harbinger");
const nativeFetch = globalThis.fetch;
// Optional curl transport for environments whose Node proxy cannot reach the RPC.
if (process.env.OSP_TEST_CURL === "1") globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input);
  if (!/^https?:/.test(url)) return nativeFetch(input, init);
  return new Promise<Response>((resolve, reject) => {
    const headers = new Headers(init.headers);
    const args = ["-sS", "--max-time", "25", "-w", "\n%{http_code}", "-X", init.method ?? "GET"];
    headers.forEach((value, key) => args.push("-H", `${key}: ${value}`));
    if (init.body !== undefined) args.push("--data-binary", "@-");
    args.push(url);
    const child = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", error = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { error += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code) { reject(new Error(error || `curl ${code}`)); return; }
      const split = output.lastIndexOf("\n");
      resolve(new Response(output.slice(0, split), { status: Number(output.slice(split + 1)), headers: { "content-type": "application/json" } }));
    });
    child.stdin.end(init.body ?? "");
  });
}) as typeof fetch;
const provider = new Provider(deployment.rpc);
if (process.env.OSP_TEST_CURL === "1") provider.call = async <T>(method: string, params: any): Promise<T> => {
  const response = await fetch(deployment.rpc[0]!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await response.json() as any;
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
};
const sponsor = "https://social-sponsor.usekoinos.com";
const client = new ProtocolClient({ rpc: provider, deployment, sponsors: [sponsor] });
const indexer = new IndexerClient({ baseUrl: "https://social-api.usekoinos.com" });
const locks = new Map<string, Promise<unknown>>();
const lock: ExclusiveLock = (name, action) => {
  const next = (locks.get(name) ?? Promise.resolve()).catch(() => {}).then(action);
  locks.set(name, next); return next;
};
const browsers = [0, 1].map(index => {
  const me = identityFromSeed(randomBytes(32));
  const store = new PrivateStore(me.account, me.seed, { chainId: client.chainId, contract: deployment.contracts.messaging.address }, () => true, memoryStorage(), lock);
  let snapshot: PrivateSnapshot = { enabled: false, registered: false, chats: [], pending: 0, error: "" };
  let last = "";
  const service = new PrivateMessagingService(me, client, indexer, store, [sponsor], "sponsor-only", next => {
    snapshot = next;
    const summary = JSON.stringify({ enabled: next.enabled, registered: next.registered, chats: next.chats.map(c => ({ status: c.status, delivery: c.requestDelivery, messages: c.messages.length })), pending: next.pending, error: next.error });
    if (summary !== last) { console.log(`BROWSER ${index + 1}`, summary); last = summary; }
  });
  return { me, service, store, get snapshot() { return snapshot; } };
});
const [a, b] = browsers;
let lastError = "";
useToasts.subscribe(state => {
  const failure = [...state.toasts].reverse().find(t => t.kind === "error");
  if (failure && failure.id !== lastError) { lastError = failure.id; console.log("SUBMISSION ERROR", failure.title, failure.message, failure.details); }
});
async function until(label: string, ready: () => boolean, timeout = 720_000) {
  console.log("WAIT", label);
  const deadline = Date.now() + timeout;
  let lastReport = 0;
  while (!ready()) {
    assert(Date.now() < deadline, `Timed out: ${label}`);
    for (const browser of browsers) { await browser.service.load(); await browser.service.sync(); }
    if (Date.now() - lastReport > 30_000) {
      for (const [index, browser] of browsers.entries()) await browser.store.edit(async data => {
        console.log("DELIVERY", index + 1, { funding: Object.values(data.funding).map(f => ({ units: f.units, lastAttempt: f.lastAttempt })), outbox: data.outbox.map(p => ({ peer: !!p.peer, attempted: !!p.lastAttempt, error: p.error })) });
      });
      lastReport = Date.now();
    }
    if (!ready()) await new Promise(resolve => setTimeout(resolve, 5_000));
  }
  console.log("PASS", label);
}
try {
  assert.equal(await provider.getChainId(), deployment.chainId);
  for (const browser of browsers) {
    console.log("REGISTER disposable account", browser.me.account);
    await client.submit({ signer: browser.me.signer, selfPayFallback: false, waitForReceipt: true, operations: [await client.ops.identity.register({ account: browser.me.account, encryption_key: browser.me.encryption.publicKey, key_version: 1 })] });
    await browser.service.enable();
  }
  await until("both messaging browsers enabled", () => browsers.every(d => d.snapshot.registered), 180_000);
  const chat = await a!.service.start(b!.me.account);
  await until("recipient sees request", () => b!.snapshot.chats.some(c => c.id === chat && c.status === "incoming"));
  await b!.service.accept(chat);
  await until("both conversations connected", () => browsers.every(d => d.snapshot.chats.some(c => c.id === chat && c.status === "ready")));
  await a!.service.send(chat, "Live test: hello from the first browser");
  await until("recipient decrypts first message", () => !!b!.snapshot.chats.find(c => c.id === chat)?.messages.some(m => !m.mine && m.text === "Live test: hello from the first browser"));
  await b!.service.send(chat, "Live test: reply from the second browser");
  await until("sender decrypts reply", () => !!a!.snapshot.chats.find(c => c.id === chat)?.messages.some(m => !m.mine && m.text === "Live test: reply from the second browser"));
  console.log("PASS live request, acceptance, and bidirectional encrypted messages");
} finally { browsers.forEach(browser => browser.service.stop()); }
