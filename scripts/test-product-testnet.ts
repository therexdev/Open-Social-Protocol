/** Opt-in product journey against the configured testnet. Never uses a user's identity.
 * node --import tsx scripts/test-product-testnet.ts --execute /absolute/private-checkpoint.json
 * Checkpoints contain disposable TEST identity seeds: keep outside the repo and never upload.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Provider } from "koilib";
import { AUDIENCE, ProtocolClient, encryptDirectMessage, identityFromSeed, randomBytes, toBase64url, fromBase64url, type Identity, type OperationJson } from "@osp/sdk";
import { IndexerClient } from "../apps/web/src/api/indexer.ts";
import { KeyStore } from "../apps/web/src/api/keystore.ts";
import { openPost } from "../apps/web/src/api/decrypt.ts";
import { chainKeyVerifier } from "../apps/web/src/api/keyProvenance.ts";
import { buildPublishPlan, findExistingPost } from "../apps/web/src/features/composer/publish.ts";
import { syncFriendKeys } from "../apps/web/src/features/friends/syncKeys.ts";
import { openVerifiedMessage } from "../apps/web/src/features/messages/verified.ts";

const checkpoint = process.argv[3];
assert(checkpoint, "A private checkpoint path is required");
assert(process.argv[2] === "--execute" && checkpoint?.startsWith("/"), "An explicit --execute and absolute private checkpoint path are required");
const deployment = JSON.parse(readFileSync(new URL("../deployments/harbinger.json", import.meta.url), "utf8"));
assert(deployment.network === "harbinger", "TESTNET ONLY");
const state = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, "utf8")) : { seeds: [toBase64url(randomBytes(32)), toBase64url(randomBytes(32))], results: {}, attempts: {}, started: new Date().toISOString() };
const save = () => writeFileSync(checkpoint, JSON.stringify(state, null, 2), { mode: 0o600 });
save();
const [a, b] = state.seeds.map((s: string) => identityFromSeed(fromBase64url(s))) as [Identity, Identity];
const provider = new Provider(deployment.rpc);
// Retry reads only. A failed mutation must be reconciled, never blindly replayed.
const rpcCall = provider.call.bind(provider);
provider.call = async <T>(method: string, params: any): Promise<T> => {
  for (let i = 0; ; i++) try { return await rpcCall<T>(method, params); }
  catch (e) { if (method === "chain.submit_transaction" || i >= 2) throw e; }
};
const client = new ProtocolClient({ rpc: provider, deployment, sponsors: ["https://social-sponsor.usekoinos.com"] });
const indexer = new IndexerClient({ baseUrl: "https://social-api.usekoinos.com" });
const keys = new Map([a, b].map((me) => [me.account, new KeyStore()]));
const verify = chainKeyVerifier(client);
const wait = async <T>(read: () => Promise<T>, ready: (v: T) => boolean): Promise<T> => {
  for (let i = 0; i < 30; i++) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Timed out waiting for chain/indexer convergence");
};
const step = async (name: string, fn: () => Promise<unknown>) => {
  if (Object.hasOwn(state.results, name)) return state.results[name];
  console.log("RUN", name);
  const result = await fn(); state.results[name] = result ?? true; save(); console.log("PASS", name); return result;
};
const submit = async (me: Identity, ops: OperationJson[]) => {
  const result = await client.submit({ operations: ops, signer: me.signer, selfPayFallback: false, waitForReceipt: true });
  assert(!result.receipt.reverted); return result.transaction.id;
};
const publish = async (me: Identity, name: string, audience: 0 | 1 = AUDIENCE.FRIENDS) => {
  const attemptId = state.attempts[name] ??= toBase64url(randomBytes(16)); save();
  const existing = await findExistingPost(client, me.account, fromBase64url(attemptId));
  if (existing) return toBase64url(existing);
  const plan = await buildPublishPlan({ chain: client, indexer, me, keys: keys.get(me.account)!, text: `Open Social automated V1 verification: ${name}`, audience, attemptId: fromBase64url(attemptId), verify });
  await submit(me, plan.operations);
  if (plan.epochKey) await keys.get(me.account)!.put({ author: me.account, audienceId: new Uint8Array(), epoch: plan.epoch }, plan.epochKey, { recipients: [me.account, ...plan.recipients] });
  return toBase64url(plan.postId);
};
const sync = (me: Identity) => syncFriendKeys({ ctx: { client, signer: me.signer, payment: "sponsor-only" }, me, keys: keys.get(me.account)!, indexer });
const readable = async (id: string, me: Identity, expected: boolean) => {
  const post = await wait(() => indexer.post(id, me.account), Boolean);
  const result = await openPost(post!, { chainId: client.chainId, chain: client, me, keys: new KeyStore(), keySource: indexer, verify });
  assert.equal(result.status === "decrypted" || result.status === "plain", expected, JSON.stringify(result));
};

async function main() {
  assert.equal(await provider.getChainId(), deployment.chainId);
  assert((await indexer.status()).healthy);
  for (const [i, me] of [a, b].entries()) await step(`register-${i}`, async () => {
    if (!(await client.reads.identity.get_identity({ account: me.account }))?.value)
      await submit(me, [await client.ops.identity.register({ account: me.account, encryption_key: me.encryption.publicKey, key_version: 1 })]);
    await wait(() => indexer.profile(me.account), Boolean); return me.account;
  });
  const publicPost = await step("public-post", () => publish(a, "public-post", AUDIENCE.EVERYONE));
  await step("public-readable", () => readable(publicPost, b, true));
  const oldA = await step("alice-old-private", () => publish(a, "alice-old-private"));
  const oldB = await step("bob-old-private", () => publish(b, "bob-old-private"));
  await step("stranger-cannot-read", () => readable(oldA, b, false));
  await step("friend-request", async () => submit(a, [await client.ops.relationships.request_friend({ requester: a.account, recipient: b.account })]));
  await step("friend-accept", async () => submit(b, [await client.ops.relationships.accept_friend({ approver: b.account, requester: a.account })]));
  await step("friend-history-both-directions", async () => {
    await wait(() => indexer.graph(a.account), g => g.friends.some(f => f.account === b.account));
    keys.set(a.account, new KeyStore()); keys.set(b.account, new KeyStore());
    await sync(a); await sync(b);
    await wait(() => indexer.keys(b.account, { author: a.account, epoch: 0 }), x => x.length > 0);
    await wait(() => indexer.keys(a.account, { author: b.account, epoch: 0 }), x => x.length > 0);
    await readable(oldA, b, true); await readable(oldB, a, true);
  });
  await step("remove-friend", async () => submit(a, [await client.ops.relationships.remove_friend({ actor: a.account, peer: b.account })]));
  const removedA = await step("alice-post-while-removed", () => publish(a, "alice-post-while-removed"));
  const removedB = await step("bob-post-while-removed", () => publish(b, "bob-post-while-removed"));
  await step("removed-friends-cannot-read", async () => { await readable(removedA, b, false); await readable(removedB, a, false); });
  await step("reverse-request", async () => submit(b, [await client.ops.relationships.request_friend({ requester: b.account, recipient: a.account })]));
  await step("reverse-accept", async () => submit(a, [await client.ops.relationships.accept_friend({ approver: a.account, requester: b.account })]));
  await step("restore-all-history-both-directions", async () => {
    await wait(() => indexer.graph(a.account), g => g.friends.some(f => f.account === b.account));
    keys.set(a.account, new KeyStore()); keys.set(b.account, new KeyStore());
    await sync(a); await sync(b);
    await wait(() => indexer.keys(b.account, { author: a.account, epoch: 1 }), x => x.length > 0);
    await wait(() => indexer.keys(a.account, { author: b.account, epoch: 1 }), x => x.length > 0);
    for (const id of [oldA, removedA]) await readable(id, b, true);
    for (const id of [oldB, removedB]) await readable(id, a, true);
  });
  await step("message-request", async () => submit(a, [await client.ops.messaging.request_conversation({ actor: a.account, peer: b.account, generation: "0" })]));
  await step("message-accept", async () => submit(b, [await client.ops.messaging.accept_conversation({ actor: b.account, peer: a.account, generation: "1" })]));
  for (const [sender, recipient] of ([[a, b], [b, a]] as Array<[Identity, Identity]>)) await step(`message-${sender.account}`, async () => {
    const id = randomBytes(32);
    const { envelope } = encryptDirectMessage({ chainId: client.chainId, contract: deployment.contracts.messaging.address, sender: sender.account, recipient: recipient.account, messageId: id, generation: "1" }, "Encrypted V1 verification message", [sender, recipient].map(me => ({ address: me.account, publicKey: me.encryption.publicKey, keyVersion: 1 })));
    await submit(sender, [await client.ops.messaging.send_message({ sender: sender.account, recipient: recipient.account, message_id: id, generation: "1", envelope })]);
    const page = await wait(() => indexer.messages(sender.account, recipient.account), p => p.items.some(row => row.message_id === toBase64url(id)));
    const row = page.items.find(row => row.message_id === toBase64url(id))!;
    for (const me of [sender, recipient]) assert.equal((await openVerifiedMessage(client, me, me === sender ? recipient.account : sender.account, row)).text, "Encrypted V1 verification message");
    return toBase64url(id);
  });
  await step("support-and-reward", async () => {
    await submit(b, [await client.ops.token.support({ actor: b.account, post_id: fromBase64url(publicPost) })]);
    const account = (await client.reads.token.get_account({ account: a.account }))?.value;
    assert(account && BigInt(account.balance) >= 1n); return account.balance;
  });
  await step("message-close", async () => submit(b, [await client.ops.messaging.close_conversation({ actor: b.account, peer: a.account, generation: "1" })]));
  await step("block", async () => submit(a, [await client.ops.relationships.block({ actor: a.account, target: b.account })]));
  await step("blocked-relationship-inactive", async () => {
    assert.notEqual((await client.reads.relationships.get_relationship({ a: a.account, b: b.account }))?.value?.status, 2);
    assert.deepEqual(await sync(a), []);
  });
  state.completed = new Date().toISOString(); save();
  console.log(JSON.stringify({ started: state.started, completed: state.completed, accounts: [a.account, b.account], results: state.results }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
