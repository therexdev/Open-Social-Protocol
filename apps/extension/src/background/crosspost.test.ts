import { describe, expect, it } from "vitest";
import {
  AUDIENCE,
  TransactionOutcomeUnknownError,
  addressToString,
  decodeEnvelope,
  decryptContent,
  fromHex,
  idempotencyKey,
  identityFromSeed,
  openEpochKeyFromSet,
  parseKeyPackageSet,
  toBase64url,
  toHex,
  x25519KeyPair,
} from "@osp/sdk";
import type { TransactionJson, TransactionReceipt } from "koilib";
import { bytesOf } from "../shared/bytes";
import { memoryArea } from "../shared/storage";
import type { FeedPage, StoredCrossPost } from "../shared/protocol";
import { explain, needsProof } from "../shared/queue";
import { CROSSPOSTS_KEY, CrossPostOrchestrator, type CrossPostDeps } from "./crosspost";
import { NO_SPONSOR_MESSAGE, PublishAttemptError, classifySubmitError, type PublishAttempt } from "./publish";
import { createTestBackground, type DecodedOp, type TestBackground } from "../test/support";

const AUTHOR = "1BKgyD7pZFSyNzupBRvvTYMLJCUuC1QLs3";
const ATTEMPT = "0102030405060708090a0b0c0d0e0f10";
const FB_POST = "https://www.facebook.com/someone/posts/123";

function timeoutReceipt(id: string): TransactionReceipt {
  return { id, payer: "", max_payer_rc: "", rc_limit: "", rc_used: "", disk_storage_used: "", network_bandwidth_used: "", compute_bandwidth_used: "", reverted: false, events: [], state_delta_entries: [], logs: [], rpc_error: { message: "timeout" } };
}

function attemptOf(postId: string, contentHash: string, transactionId?: string): PublishAttempt {
  return { postId, contentHash, sequence: "1", epoch: 0, versionNumber: 1, ...(transactionId && { transactionId }) };
}

function deps(overrides: Partial<CrossPostDeps> = {}) {
  const storage = memoryArea();
  const chain = new Map<string, Uint8Array>();
  let clock = 10 * 60_000; // the fake clock starts well past STALE_SUBMITTING_MS so a record with updatedAt 0 counts as interrupted
  const publishCalls: string[] = [];
  const base: CrossPostDeps = {
    storage,
    now: () => (clock += 1),
    account: async () => AUTHOR,
    publishKoinos: async (record) => {
      publishCalls.push(record.attemptId);
      const postId = "aa".repeat(32);
      chain.set(record.idempotencyKey, fromHex(postId));
      return { txId: "0x1220" + "11".repeat(32), postId, contentHash: "bb".repeat(32), sequence: "1", epoch: 0, versionNumber: 1, sponsored: false };
    },
    lookupChain: async (_author, key) => {
      const found = chain.get(toHex(key));
      return found ? { value: { post_id: found } } : undefined;
    },
    ...overrides,
  };
  return { deps: base, storage, chain, publishCalls, orchestrator: new CrossPostOrchestrator(base) };
}

const proposal = { hostSite: "facebook" as const, text: "from facebook", attemptId: ATTEMPT, url: "https://www.facebook.com/", submitted: true, userGesture: true };

describe("cross-post orchestrator", () => {
  it("persists proposals as drafts and never publishes them without confirmation", async () => {
    const { orchestrator, storage, publishCalls } = deps();
    const record = await orchestrator.propose(proposal);
    expect(record.state).toBe("draft");
    expect(record.hostStatus).toBe("pending");
    expect(record.idempotencyKey).toBe(toHex(idempotencyKey(AUTHOR, fromHex(ATTEMPT))));
    const again = await orchestrator.propose(proposal);
    expect(again.attemptId).toBe(record.attemptId);
    expect((await storage.get<{ records: StoredCrossPost[] }>(CROSSPOSTS_KEY))?.records).toHaveLength(1);
    expect(publishCalls).toEqual([]);
    expect(explain(record).actions).toEqual(["confirm", "discard"]);
  });

  it("confirm publishes Koinos once; the Facebook side stays pending until the user reports it with the post link", async () => {
    const proofs: StoredCrossPost[] = [];
    const { orchestrator, publishCalls, deps: d } = deps({
      recordProof: async (record) => {
        proofs.push(record);
        return { manifestHash: "ab".repeat(32), txId: "0x1220" + "55".repeat(32), outcome: 0, koinosTxId: record.koinosTxId ?? "" };
      },
    });
    await orchestrator.propose(proposal);
    const published = await orchestrator.confirm(ATTEMPT, { audience: 0 });
    // Pressing Post on Facebook is not proof that Facebook published it: nothing is assumed.
    expect(published.state).toBe("submitting");
    expect(published.koinosStatus).toBe("ok");
    expect(published.hostStatus).toBe("pending");
    expect(published.hostRef).toBeUndefined();
    expect(published.hostSubmitted).toBe(true);
    expect(published.postId).toBe("aa".repeat(32));
    expect(published.text).toBeUndefined();
    expect(publishCalls).toEqual([ATTEMPT]);
    expect(needsProof(published)).toBe(false);
    expect(proofs).toEqual([]);
    const explanation = explain(published);
    expect(explanation.actions).toEqual(["markHostPosted", "markHostFailed"]);
    expect(explanation.detail).toContain("paste its link");
    await expect(orchestrator.confirm(ATTEMPT)).rejects.toThrow(/submitting/);
    await expect(orchestrator.retry(ATTEMPT)).rejects.toThrow(/not available/);
    // "posted" needs the link to the Facebook post; the composer page is never accepted as the reference
    await expect(orchestrator.markHost(ATTEMPT, "posted")).rejects.toThrow(/link/i);
    await expect(orchestrator.markHost(ATTEMPT, "posted", "https://example.org/not-facebook")).rejects.toThrow(/facebook\.com/);
    await expect(orchestrator.markHost(ATTEMPT, "posted", "javascript:alert(1)")).rejects.toThrow(/http/);
    const done = await orchestrator.markHost(ATTEMPT, "posted", FB_POST);
    expect(done.state).toBe("succeeded");
    expect(done.hostRef).toBe(FB_POST);
    expect(done.proof?.manifestHash).toBe("ab".repeat(32));
    expect(proofs).toHaveLength(1);
    expect(proofs[0]!.hostRef).toBe(FB_POST);
    expect(proofs[0]!.hostStatus).toBe("ok");
    expect(explain(done).detail).toContain("signed proof (Facebook)");
    // reloading from storage yields the same state (persistence)
    expect((await new CrossPostOrchestrator(d).get(ATTEMPT))?.state).toBe("succeeded");
  });

  it("a failed Facebook host side records a PARTIAL proof once Koinos succeeded", async () => {
    const proofs: StoredCrossPost[] = [];
    const { orchestrator } = deps({
      recordProof: async (record) => {
        proofs.push(record);
        return { manifestHash: "cd".repeat(32), txId: "0x1220" + "56".repeat(32), outcome: record.hostStatus === "failed" ? 1 : 0, koinosTxId: record.koinosTxId ?? "" };
      },
    });
    await orchestrator.propose(proposal);
    await orchestrator.confirm(ATTEMPT, { audience: 0 });
    const failed = await orchestrator.markHost(ATTEMPT, "failed", "Facebook rejected the post");
    expect(failed.state).toBe("partial");
    expect(failed.hostStatus).toBe("failed");
    expect(failed.hostRef).toBeUndefined();
    expect(failed.proof?.outcome).toBe(1);
    expect(proofs).toHaveLength(1);
    expect(explain(failed).title).toContain("Facebook side failed");
  });

  it("koinos failure with a pending Facebook side offers retry and host reporting; retry republishes only Koinos with the same key", async () => {
    let fail = true;
    const d = deps({
      publishKoinos: async (record) => {
        if (fail) throw new Error("rpc rejected: insufficient rc");
        const postId = "cc".repeat(32);
        d.chain.set(record.idempotencyKey, fromHex(postId));
        return { txId: "0x1220" + "22".repeat(32), postId, contentHash: "dd".repeat(32), sequence: "2", epoch: 0, versionNumber: 1, sponsored: true };
      },
    });
    await d.orchestrator.propose(proposal);
    const failed = await d.orchestrator.confirm(ATTEMPT);
    expect(failed.koinosStatus).toBe("failed");
    expect(failed.hostStatus).toBe("pending");
    const explanation = explain(failed);
    expect(explanation.title).toBe("Not published on Open Social");
    expect(explanation.actions).toEqual(["retry", "markHostPosted", "markHostFailed", "discard"]);
    // the user can report the host side before the Koinos retry (spec 7: host succeeded, Koinos failed)
    const hostOk = await d.orchestrator.markHost(ATTEMPT, "posted", FB_POST);
    expect(hostOk.state).toBe("partial");
    expect(explain(hostOk).actions).toContain("retry");
    fail = false;
    const retried = await d.orchestrator.retry(ATTEMPT);
    expect(retried.state).toBe("succeeded");
    expect(retried.idempotencyKey).toBe(failed.idempotencyKey);
    expect(retried.hostRef).toBe(FB_POST);
  });

  it("unknown outcome keeps the attempt (content hash, expected post id, tx id); retry looks the key up before anything is re-sent", async () => {
    let calls = 0;
    const txId = "0x1220" + "33".repeat(32);
    const d = deps({
      publishKoinos: async (record) => {
        calls += 1;
        if (calls > 1) throw new Error("must not republish");
        // the node accepted it but the answer was lost
        d.chain.set(record.idempotencyKey, fromHex("ee".repeat(32)));
        throw new PublishAttemptError(new TransactionOutcomeUnknownError({ id: txId } as TransactionJson, timeoutReceipt(txId)), attemptOf("ee".repeat(32), "e1".repeat(32), txId));
      },
    });
    await d.orchestrator.propose({ ...proposal, submitted: false });
    const unknown = await d.orchestrator.confirm(ATTEMPT);
    expect(unknown.state).toBe("unknown");
    expect(unknown.contentHash).toBe("e1".repeat(32));
    expect(unknown.expectedPostId).toBe("ee".repeat(32));
    expect(unknown.pendingTxId).toBe(txId);
    expect(unknown.postId).toBeUndefined();
    expect(unknown.koinosTxId).toBeUndefined();
    expect(explain(unknown).actions).toEqual(["reconcile"]);
    const resolved = await d.orchestrator.retry(ATTEMPT);
    expect(resolved.koinosStatus).toBe("ok");
    expect(resolved.postId).toBe("ee".repeat(32));
    expect(resolved.koinosTxId).toBe(txId); // the attempt's transaction id is adopted once the chain confirms the post id
    expect(resolved.pendingTxId).toBeUndefined();
    expect(resolved.contentHash).toBe("e1".repeat(32));
    expect(calls).toBe(1); // never republished
  });

  it("unknown outcome not on chain yet: the indexer lookup receives the attempt's content hash and can resolve it", async () => {
    const seen: StoredCrossPost[] = [];
    const d = deps({
      publishKoinos: async () => {
        throw new PublishAttemptError(new Error("fetch failed: network error"), attemptOf("ab".repeat(32), "ac".repeat(32)));
      },
      lookupChain: async () => undefined,
      lookupIndexer: async (_author, record) => {
        seen.push(record);
        return record.contentHash === "ac".repeat(32) ? { postId: "ab".repeat(32), txId: "0x1220" + "77".repeat(32) } : null;
      },
    });
    await d.orchestrator.create({ text: "side panel post", audience: 0, adapter: "sidepanel" }, ATTEMPT);
    const unknown = await d.orchestrator.confirm(ATTEMPT);
    expect(unknown.state).toBe("unknown");
    expect(unknown.pendingTxId).toBeUndefined(); // no transaction id was known
    const resolved = await d.orchestrator.reconcile(ATTEMPT);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.contentHash).toBe("ac".repeat(32));
    expect(resolved.state).toBe("succeeded");
    expect(resolved.postId).toBe("ab".repeat(32));
    expect(resolved.koinosTxId).toBe("0x1220" + "77".repeat(32));
  });

  it("unknown outcome not found anywhere: reconcile marks it safe to retry, then retry publishes", async () => {
    let calls = 0;
    const d = deps({
      publishKoinos: async (record) => {
        calls += 1;
        if (calls === 1) throw new PublishAttemptError(new Error("network error: fetch failed"), attemptOf("f0".repeat(32), "f1".repeat(32)));
        d.chain.set(record.idempotencyKey, fromHex("ff".repeat(32)));
        return { txId: "0x1220" + "44".repeat(32), postId: "ff".repeat(32), contentHash: "aa".repeat(32), sequence: "3", epoch: 0, versionNumber: 1, sponsored: false };
      },
    });
    await d.orchestrator.propose(proposal);
    const unknown = await d.orchestrator.confirm(ATTEMPT);
    expect(unknown.state).toBe("unknown");
    const looked = await d.orchestrator.reconcile(ATTEMPT);
    expect(looked.koinosStatus).toBe("failed");
    expect(looked.lastError).toMatch(/safe to retry/);
    expect(explain(looked).actions).toContain("retry");
    const done = await d.orchestrator.retry(ATTEMPT);
    expect(done.koinosStatus).toBe("ok");
    expect(done.postId).toBe("ff".repeat(32));
    expect(done.expectedPostId).toBe("ff".repeat(32)); // the new attempt replaced the failed one
    expect(calls).toBe(2);
  });

  it("errors raised before anything was sent are failures, not unknown outcomes", () => {
    expect(classifySubmitError(new Error("The indexer at https://x is not reachable (network error).")).kind).toBe("failed");
    expect(classifySubmitError(new Error("fetch failed: timeout")).kind).toBe("failed");
    expect(classifySubmitError(new PublishAttemptError(new Error("fetch failed: timeout"), attemptOf("00".repeat(32), "01".repeat(32)))).kind).toBe("unknown");
    expect(classifySubmitError(new TransactionOutcomeUnknownError({ id: "0x1220" } as TransactionJson, timeoutReceipt("0x1220"))).kind).toBe("unknown");
    expect(classifySubmitError(new Error("transaction reverted: duplicate idempotency key")).kind).toBe("duplicate");
  });

  it("duplicate idempotency key resolves to the existing post instead of failing", async () => {
    const d = deps({
      publishKoinos: async (record) => {
        d.chain.set(record.idempotencyKey, fromHex("12".repeat(32)));
        throw new Error("transaction reverted: duplicate idempotency key");
      },
    });
    await d.orchestrator.create({ text: "side panel post", audience: 1, adapter: "sidepanel" }, ATTEMPT);
    const done = await d.orchestrator.confirm(ATTEMPT);
    expect(done.state).toBe("succeeded");
    expect(done.postId).toBe("12".repeat(32));
    expect(done.hostStatus).toBe("not_required");
  });

  it("explains a failed Koinos-only attempt without inventing a host side, and retry republishes", async () => {
    let fail = true;
    const d = deps({
      publishKoinos: async (record) => {
        if (fail) throw new Error("Protocol contracts are not deployed on harbinger yet");
        d.chain.set(record.idempotencyKey, fromHex("34".repeat(32)));
        return { txId: "0x1220" + "66".repeat(32), postId: "34".repeat(32), contentHash: "cc".repeat(32), sequence: "4", epoch: 0, versionNumber: 1, sponsored: false };
      },
    });
    await d.orchestrator.create({ text: "side panel post", audience: 0, adapter: "sidepanel" }, ATTEMPT);
    const failed = await d.orchestrator.confirm(ATTEMPT);
    expect(failed.hostStatus).toBe("not_required");
    expect(failed.koinosStatus).toBe("failed");
    expect(failed.text).toBe("side panel post"); // the draft text is kept for the retry
    const explanation = explain(failed);
    expect(explanation.title).toBe("Not published on Open Social");
    expect(explanation.detail).toContain("not deployed");
    expect(explanation.actions).toEqual(["retry", "discard"]);
    fail = false;
    const done = await d.orchestrator.retry(ATTEMPT);
    expect(done.state).toBe("succeeded");
    expect(done.postId).toBe("34".repeat(32));
    expect(done.text).toBeUndefined();
  });

  it("'share current page' and side panel posts never record a cross-post proof", async () => {
    const proofs: string[] = [];
    const d = deps({
      recordProof: async (record) => {
        proofs.push(record.attemptId);
        return { manifestHash: "ab".repeat(32), txId: "0x1220" + "55".repeat(32), outcome: 0, koinosTxId: "" };
      },
    });
    await d.orchestrator.create({ text: "look at this", audience: 0, adapter: "generic", url: "https://example.org/article", title: "Article" }, ATTEMPT);
    const done = await d.orchestrator.confirm(ATTEMPT);
    expect(done.state).toBe("succeeded");
    expect(done.hostStatus).toBe("not_required");
    expect(needsProof(done)).toBe(false);
    expect(done.proof).toBeUndefined();
    expect(proofs).toEqual([]);
    const explanation = explain(done);
    expect(explanation.actions).toEqual([]);
    expect(explanation.detail).toBe("Published on Open Social.");
    await expect(d.orchestrator.recordProof(ATTEMPT)).rejects.toThrow(/Nothing to record/);
    await expect(d.orchestrator.markHost(ATTEMPT, "posted", "https://example.org/article")).rejects.toThrow(/no host side/);
  });

  it("conflicting facts move the record to reconcile_required, which only discard leaves", async () => {
    const d = deps({ lookupChain: async () => ({ value: { post_id: fromHex("99".repeat(32)) } }) });
    await d.orchestrator.create({ text: "side panel post", audience: 0, adapter: "sidepanel" }, ATTEMPT);
    const done = await d.orchestrator.confirm(ATTEMPT);
    expect(done.state).toBe("succeeded");
    const conflict = await d.orchestrator.reconcile(ATTEMPT);
    expect(conflict.state).toBe("reconcile_required");
    expect(explain(conflict).actions).toEqual(["discard"]);
    await expect(d.orchestrator.retry(ATTEMPT)).rejects.toThrow();
    await d.orchestrator.discard(ATTEMPT);
    expect(await d.orchestrator.get(ATTEMPT)).toBeUndefined();
  });

  it("sweep turns interrupted submissions into unknown and resolves them by lookup", async () => {
    const d = deps();
    await d.orchestrator.propose(proposal);
    // simulate a service worker killed mid-flight: write a stale "submitting" record directly
    const file = await d.storage.get<{ version: 1; records: StoredCrossPost[] }>(CROSSPOSTS_KEY);
    const stale = { ...file!.records[0]!, state: "submitting" as const, updatedAt: 0, author: AUTHOR };
    await d.storage.set(CROSSPOSTS_KEY, { version: 1, records: [stale] });
    d.chain.set(stale.idempotencyKey, fromHex("77".repeat(32)));
    await d.orchestrator.sweep();
    const after = await d.orchestrator.get(ATTEMPT);
    expect(after?.koinosStatus).toBe("ok");
    expect(after?.postId).toBe("77".repeat(32));
  });
});

// ---------------------------------------------------------------------------
// End to end through the service worker
// ---------------------------------------------------------------------------

const PASS = "correct horse battery";

/** Creates an account and authorizes the device (device-only vault unless `keepOwnerSeed`). */
async function onboard(t: TestBackground, keepOwnerSeed = false): Promise<string> {
  const { account } = await t.call<{ account: string }>("vault.create", { passphrase: PASS });
  await t.call("device.authorize", { passphrase: PASS, keepOwnerSeed });
  return account;
}

function methods(ops: DecodedOp[]): string[] {
  return ops.map((op) => op.method);
}

describe("service worker end to end (mock chrome.storage + fake ProtocolClient provider + fake sponsor)", () => {
  it("create account, authorize device, publish through the sponsor with a timeout, reconcile from chain keeping the tx id", async () => {
    const t = createTestBackground({ indexer: true });
    await t.call("vault.create", { passphrase: PASS });
    const status = await t.call<{ status: string; deviceAuthorized: boolean; ownerAvailable: boolean }>("vault.status");
    expect(status.status).toBe("unlocked");
    expect(status.deviceAuthorized).toBe(false);
    expect(status.ownerAvailable).toBe(true);

    const authorized = await t.call<{ device: { address: string }; registered: boolean; mode: string }>("device.authorize", { passphrase: PASS, keepOwnerSeed: false });
    expect(authorized.registered).toBe(true);
    expect(authorized.mode).toBe("device");
    expect(t.state.devices.size).toBe(1);
    const chainDevice = await t.call<{ authorized: boolean }>("device.status");
    expect(chainDevice.authorized).toBe(true);

    // first broadcast of the post: the sponsor's node times out (200 + receipt with rpc_error, spec 10)
    let publishes = 0;
    t.state.onSend = (_tx, decoded) => {
      if (decoded.some((d) => d.method === "publish")) {
        publishes += 1;
        if (publishes === 1) {
          const publish = decoded.find((d) => d.method === "publish")!;
          t.state.postsByKey.set(`${publish.args.author}|${toHex(publish.args.idempotency_key as Uint8Array)}`, publish.args.post_id as Uint8Array);
          return { rpc_error: { message: "timed out waiting for the node" } } as never;
        }
      }
      return undefined;
    };
    const draft = await t.call<{ record: StoredCrossPost }>("crosspost.create", { text: "hello chain", audience: 0, adapter: "sidepanel" });
    expect(draft.record.state).toBe("draft");
    const unknown = await t.call<{ record: StoredCrossPost }>("crosspost.confirm", { attemptId: draft.record.attemptId, audience: 0 });
    expect(unknown.record.state).toBe("unknown");
    expect(publishes).toBe(1);
    // the sponsor co-signed the device authorization (owner as payee) and then the publish (device as payee)
    expect(t.sponsor.received).toHaveLength(2);
    const publishTx = t.sponsor.received[1]!;
    expect(unknown.record.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(unknown.record.expectedPostId).toMatch(/^[0-9a-f]{64}$/);
    expect(unknown.record.pendingTxId).toBe(publishTx.id);
    expect(t.chrome.action._badge.text).toBe("1");

    const reconciled = await t.call<{ record: StoredCrossPost }>("crosspost.reconcile", { attemptId: draft.record.attemptId });
    expect(reconciled.record.state).toBe("succeeded");
    expect(reconciled.record.postId).toBe(reconciled.record.expectedPostId);
    expect(reconciled.record.koinosTxId).toBe(publishTx.id);
    expect(reconciled.record.contentHash).toBe(unknown.record.contentHash);
    expect(publishes).toBe(1); // never republished
    expect(t.sponsor.received).toHaveLength(2); // nothing else was sent to the sponsor
    expect(t.chrome.action._badge.text).toBe("");
    // the device signed as payee, the sponsor paid
    const sent = t.provider.sent.filter((s) => s.broadcast);
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(publishTx.header?.payee).toBe(authorized.device.address);
    expect(publishTx.header?.payer).toBe(t.sponsor.address);
  });

  it("friends-only: recipients are confirmed on chain, keys come from the chain, one distribute_keys + publish per epoch, readers decrypt", async () => {
    const t = createTestBackground({ indexer: true });
    const me = await onboard(t);
    const friend = identityFromSeed(new Uint8Array(32).fill(7));
    const stranger = identityFromSeed(new Uint8Array(32).fill(9));
    const attackerKeys = x25519KeyPair();
    t.state.registerIdentity(friend.account, friend.encryption.publicKey);
    t.state.registerIdentity(stranger.account, stranger.encryption.publicKey);
    t.state.befriend(me, friend.account);
    // A hostile indexer: claims the stranger is a friend and serves the attacker's key for the real friend.
    t.indexer.extraFriends = [stranger.account];
    t.indexer.profiles.set(friend.account, { encryptionKey: toBase64url(attackerKeys.publicKey) });
    t.indexer.profiles.set(stranger.account, { encryptionKey: toBase64url(attackerKeys.publicKey) });

    const draft = await t.call<{ record: StoredCrossPost }>("crosspost.create", { text: "friends only", audience: AUDIENCE.FRIENDS, adapter: "sidepanel" });
    const done = await t.call<{ record: StoredCrossPost }>("crosspost.confirm", { attemptId: draft.record.attemptId, audience: AUDIENCE.FRIENDS });
    expect(done.record.state).toBe("succeeded");
    // no key existed for epoch 0 anywhere: the audience is rotated and the new epoch's key distributed with the post
    const broadcast = t.state.broadcasts.at(-1)!;
    expect(methods(broadcast.ops)).toEqual(["rotate_audience", "distribute_keys", "publish"]);
    const distribute = broadcast.ops[1]!.args;
    const publish = broadcast.ops[2]!.args;
    expect(distribute.epoch).toBe(1);
    expect(publish.epoch).toBe(1);
    expect(done.record.epoch).toBe(1);
    expect(t.state.audienceEpoch[me]).toBe(1);
    // sealed to me + the chain-confirmed friend only, with the chain's key (the indexer's key and its extra "friend" are ignored)
    const set = parseKeyPackageSet(distribute.packages as Uint8Array);
    expect(set.epoch).toBe(1);
    const recipients = set.keys.map((k) => addressToString(k.recipient)).sort();
    expect(recipients).toEqual([me, friend.account].sort());
    expect(recipients).not.toContain(stranger.account);
    const friendKey = openEpochKeyFromSet(set, friend.account, friend.encryption.secretKey);
    expect(friendKey).toBeInstanceOf(Uint8Array);
    expect(openEpochKeyFromSet(set, stranger.account, stranger.encryption.secretKey)).toBeUndefined();
    expect(() => openEpochKeyFromSet(set, friend.account, attackerKeys.secretKey)).toThrow();
    // the friend can read the post with the key sealed to them
    const envelope = decodeEnvelope(publish.envelope as Uint8Array);
    const aad = { chainId: t.deployment.chainId, author: me, audience: AUDIENCE.FRIENDS, epoch: 1, versionNumber: 1 };
    expect(decryptContent({ envelope, aad, epochKey: friendKey! }).text).toBe("friends only");

    // a second post reuses the cached key: no rotation, no distribution
    const second = await t.call<{ record: StoredCrossPost }>("crosspost.create", { text: "again", audience: AUDIENCE.FRIENDS, adapter: "sidepanel" });
    await t.call("crosspost.confirm", { attemptId: second.record.attemptId, audience: AUDIENCE.FRIENDS });
    expect(methods(t.state.broadcasts.at(-1)!.ops)).toEqual(["publish"]);
    expect(t.state.broadcasts.at(-1)!.ops[0]!.args.epoch).toBe(1);

    // the author's own feed decrypts through the indexer's sealed keys once the local cache is gone (another device / fresh install)
    await t.call("vault.lock");
    await t.local.remove(`osp.keys.${me}`);
    await t.call("vault.unlock", { passphrase: PASS });
    const feed = await t.call<FeedPage>("feed.get", { scope: "friends", refresh: true });
    expect(feed.items.map((i) => [i.status, i.text])).toEqual([
      ["decrypted", "again"],
      ["decrypted", "friends only"],
    ]);
    expect(t.indexer.requests.some((u) => u.includes(`/v1/keys/${encodeURIComponent(me)}`))).toBe(true);
    expect(bytesOf(feed.items[0]!.postId)).toHaveLength(32);
  });

  it("friends-only: an existing epoch without an indexed key is rotated, never given a second key", async () => {
    const t = createTestBackground({ indexer: true });
    const me = await onboard(t);
    t.state.audienceEpoch[me] = 3; // rotated elsewhere; the key for epoch 3 may exist on another device
    t.indexer.keysOverride = () => [];
    const draft = await t.call<{ record: StoredCrossPost }>("crosspost.create", { text: "no key for epoch 3 here", audience: AUDIENCE.FRIENDS, adapter: "sidepanel" });
    const done = await t.call<{ record: StoredCrossPost }>("crosspost.confirm", { attemptId: draft.record.attemptId, audience: AUDIENCE.FRIENDS });
    expect(done.record.state).toBe("succeeded");
    const ops = t.state.broadcasts.at(-1)!.ops;
    expect(methods(ops)).toEqual(["rotate_audience", "distribute_keys", "publish"]);
    expect(ops[1]!.args.epoch).toBe(4);
    expect(ops[2]!.args.epoch).toBe(4);
    expect(t.state.keyPackages.map((k) => k.epoch)).toEqual([4]);
    expect(t.state.audienceEpoch[me]).toBe(4);
  });

  it("friends-only: an unreachable indexer is a plain failure before anything is sent, not an unknown outcome", async () => {
    const t = createTestBackground({ indexer: true });
    await onboard(t);
    t.indexer.unreachable = true;
    const sentBefore = t.provider.sent.length;
    const draft = await t.call<{ record: StoredCrossPost }>("crosspost.create", { text: "friends only", audience: AUDIENCE.FRIENDS, adapter: "sidepanel" });
    const failed = await t.call<{ record: StoredCrossPost; explanation: { title: string; actions: string[] } }>("crosspost.confirm", { attemptId: draft.record.attemptId, audience: AUDIENCE.FRIENDS });
    expect(failed.record.koinosStatus).toBe("failed");
    expect(failed.record.state).not.toBe("unknown");
    expect(failed.record.lastError).toMatch(/indexer/i);
    expect(failed.explanation.actions).toEqual(["retry", "discard"]);
    expect(t.provider.sent.length).toBe(sentBefore);
  });

  it("device-only vault without a sponsor cannot pay: fails before sending with a clear message; owner mode pays with the owner key", async () => {
    const noSponsor = createTestBackground({ sponsor: false });
    const account = await onboard(noSponsor); // authorizing self-pays with the owner key, which still works
    const sentBefore = noSponsor.provider.sent.length;
    const draft = await noSponsor.call<{ record: StoredCrossPost }>("crosspost.create", { text: "hello", audience: 0, adapter: "sidepanel" });
    const failed = await noSponsor.call<{ record: StoredCrossPost }>("crosspost.confirm", { attemptId: draft.record.attemptId, audience: 0 });
    expect(failed.record.koinosStatus).toBe("failed");
    expect(failed.record.lastError).toBe(NO_SPONSOR_MESSAGE);
    expect(noSponsor.provider.sent.length).toBe(sentBefore);
    // "always pay myself" is refused too in device mode
    await noSponsor.call("settings.update", { patch: { payment: "self-only", sponsorUrls: ["https://sponsor.test"] } });
    const again = await noSponsor.call<{ record: StoredCrossPost }>("crosspost.retry", { attemptId: draft.record.attemptId });
    expect(again.record.lastError).toMatch(/only a device key/);
    expect(noSponsor.provider.sent.length).toBe(sentBefore);

    // owner mode (seed kept): the owner pays, the device signs the protocol action
    const owner = createTestBackground({ sponsor: false });
    const ownerAccount = await onboard(owner, true);
    const device = (await owner.call<{ device: { address: string } }>("vault.status")).device.address;
    const d2 = await owner.call<{ record: StoredCrossPost }>("crosspost.create", { text: "self paid", audience: 0, adapter: "sidepanel" });
    const done = await owner.call<{ record: StoredCrossPost }>("crosspost.confirm", { attemptId: d2.record.attemptId, audience: 0 });
    expect(done.record.state).toBe("succeeded");
    const tx = owner.state.broadcasts.at(-1)!.transaction;
    expect(tx.header?.payer).toBe(ownerAccount);
    expect(tx.header?.payee).toBe(device);
    expect(tx.signatures).toHaveLength(2);
    void account;
  });

  it("a Facebook attempt records the proof only after the user reports the host side, with the post link as external_ref", async () => {
    const t = createTestBackground({ origins: ["https://www.facebook.com/*"], indexer: true });
    await onboard(t);
    await t.call("adapter.enable", { adapter: "facebook" });
    const sender = t.chrome._contentSender("https://www.facebook.com/home");
    const payload = { hostSite: "facebook", text: "from fb", attemptId: "0a".repeat(16), url: "https://www.facebook.com/home", submitted: true, userGesture: true };
    const queued = (await t.chrome._dispatch({ type: "crosspost.propose", payload }, sender)) as { ok: boolean; result: { state: string } };
    expect(queued).toMatchObject({ ok: true, result: { state: "draft" } });
    const published = await t.call<{ record: StoredCrossPost }>("crosspost.confirm", { attemptId: "0a".repeat(16), audience: 0 });
    expect(published.record.koinosStatus).toBe("ok");
    expect(published.record.hostStatus).toBe("pending");
    expect(methods(t.state.broadcasts.at(-1)!.ops)).toEqual(["publish"]);
    // the envelope of a Facebook proposal carries no external_ref: the composer page is not the post
    const envelope = decodeEnvelope(t.state.broadcasts.at(-1)!.ops[0]!.args.envelope as Uint8Array);
    expect(decryptContent({ envelope }).external_ref).toBe("");
    const marked = await t.call<{ record: StoredCrossPost }>("crosspost.markHost", { attemptId: "0a".repeat(16), outcome: "posted", detail: FB_POST });
    expect(marked.record.state).toBe("succeeded");
    expect(marked.record.proof?.outcome).toBe(0);
    const proofOps = t.state.broadcasts.at(-1)!.ops;
    expect(methods(proofOps)).toEqual(["record_cross_post"]);
    expect(proofOps[0]!.args.external_ref).toBe(FB_POST);
    expect(proofOps[0]!.args.state).toBe(0);
    expect(proofOps[0]!.args.adapter).toBe("facebook");
    expect(toHex(proofOps[0]!.args.post_id as Uint8Array)).toBe(marked.record.postId);
  });

  it("'share current page' publishes one transaction and records no proof", async () => {
    const t = createTestBackground();
    await onboard(t);
    const draft = await t.call<{ record: StoredCrossPost }>("crosspost.create", { text: "look", audience: 0, adapter: "generic", url: "https://example.org/a", title: "A" });
    const done = await t.call<{ record: StoredCrossPost }>("crosspost.confirm", { attemptId: draft.record.attemptId, audience: 0 });
    expect(done.record.state).toBe("succeeded");
    expect(done.record.proof).toBeUndefined();
    const after = t.state.broadcasts.filter((b) => b.ops.some((op) => op.method === "publish" || op.method === "record_cross_post"));
    expect(after.map((b) => methods(b.ops))).toEqual([["publish"]]);
    const envelope = decodeEnvelope(after[0]!.ops[0]!.args.envelope as Uint8Array);
    expect(decryptContent({ envelope }).external_ref).toBe("https://example.org/a");
  });

  it("drafts that would exceed the 4096-byte envelope are refused at creation, from the side panel and from content scripts", async () => {
    const t = createTestBackground({ origins: ["https://www.facebook.com/*"] });
    await onboard(t);
    await t.call("adapter.enable", { adapter: "facebook" });
    const cjk = "漢".repeat(3000);
    await expect(t.call("crosspost.create", { text: cjk, audience: 0, adapter: "sidepanel" })).rejects.toThrow(/bytes once encoded/);
    const longUrl = "https://example.org/" + "x".repeat(1200);
    await expect(t.call("crosspost.create", { text: "a".repeat(3000), audience: 0, adapter: "generic", url: longUrl })).rejects.toThrow(/drop the shared link/);
    const sender = t.chrome._contentSender("https://www.facebook.com/home");
    const payload = { hostSite: "facebook", text: cjk, attemptId: "0b".repeat(16), url: "https://www.facebook.com/home", submitted: true, userGesture: true };
    const refused = (await t.chrome._dispatch({ type: "crosspost.propose", payload }, sender)) as { ok: boolean; error?: { message: string } };
    expect(refused.ok).toBe(false);
    expect(refused.error?.message).toMatch(/bytes once encoded/);
    expect((await t.call<{ items: unknown[] }>("crosspost.list")).items).toHaveLength(0);
    // a post that fits is accepted
    const ok = await t.call<{ record: StoredCrossPost }>("crosspost.create", { text: "a".repeat(3000), audience: 0, adapter: "sidepanel" });
    expect(ok.record.state).toBe("draft");
  });

  it("content-script proposals become drafts only when the adapter is enabled and the origin is granted", async () => {
    const t = createTestBackground({ origins: ["https://www.facebook.com/*"] });
    const sender = t.chrome._contentSender("https://www.facebook.com/home");
    const payload = { hostSite: "facebook", text: "from fb", attemptId: "0a".repeat(16), url: "https://www.facebook.com/home", submitted: true, userGesture: true };
    const disabled = (await t.chrome._dispatch({ type: "crosspost.propose", payload }, sender)) as { ok: boolean; error?: { message: string } };
    expect(disabled.ok).toBe(false);
    expect(disabled.error?.message).toMatch(/disabled/);
    await t.call("adapter.enable", { adapter: "facebook" });
    expect(t.chrome.scripting._registered.has("osp-facebook-adapter")).toBe(true);
    const queued = (await t.chrome._dispatch({ type: "crosspost.propose", payload }, sender)) as { ok: boolean; result: { state: string } };
    expect(queued).toMatchObject({ ok: true, result: { state: "draft" } });
    expect(t.chrome.action._badge.text).toBe("1");
    const feed = (await t.chrome._dispatch({ type: "feed.request", payload: {} }, sender)) as { ok: boolean; result: { enabled: boolean } };
    expect(feed).toMatchObject({ ok: true, result: { enabled: false } });
    await t.call("adapter.disable", { adapter: "facebook" });
    expect(t.chrome.scripting._registered.size).toBe(0);
    expect((await t.chrome.permissions.getAll()).origins).toEqual([]);
  });
});
