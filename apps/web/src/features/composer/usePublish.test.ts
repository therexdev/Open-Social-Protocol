// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AUDIENCE, ProtocolClient, RELATIONSHIP_STATUS, decode, identityFromSeed, encryptMedia, toBase64url } from "@osp/sdk";
import { IndexerClient } from "../../api/indexer";
import { fakeIndexerFetch, fakeProvider, fixtureDeployment, readResult } from "../../testing/fixtures";
import { bytesOf } from "../../util/bytes";
import { unsupportedPasskey } from "../../vault/passkey";
import { memoryStorage } from "../../vault/storage";
import { createVaultStore, type Session } from "../../vault/store";
import { listDrafts, newDraft, saveDraft } from "./drafts";
import { planDraft, publishDraft, type PublishDeps } from "./usePublish";

import { startPublication, waitForPublication } from "./backgroundPublishing";
import { reconcileDraft } from "./publishDraft";
import { submitAction } from "../../tx/submit";
const deployment = fixtureDeployment();
const friend = identityFromSeed(new Uint8Array(32).fill(9));

async function openSession(): Promise<Session> {
  const vault = createVaultStore({ storage: memoryStorage(), kdf: { N: 1024, r: 8, p: 1 }, passkey: unsupportedPasskey });
  await vault.getState().init();
  await vault.getState().create("correct horse battery");
  return vault.getState().session!;
}

function chainFor(me: string) {
  const state = { epoch: 1, sequence: "1", existing: undefined as Uint8Array | undefined };
  const probe = new ProtocolClient({ rpc: fakeProvider(), deployment });
  const entry = (contract: "relationships" | "publications" | "identity", method: string) => probe.contracts.method(contract, method).entry_point;
  const provider = fakeProvider({
    onRead: (op) => {
      if (op.entry_point === entry("relationships", "get_audience")) return readResult("relationships.get_audience_result", { value: { epoch: state.epoch, updated_at: "1" } });
      if (op.entry_point === entry("relationships", "get_relationship")) {
        const { a, b } = decode<{ a: string; b: string }>("relationships.get_relationship_arguments", bytesOf(op.args));
        return readResult("relationships.get_relationship_result", { value: { a, b, status: RELATIONSHIP_STATUS.ACTIVE, requester: b, nonce: "2", updated_at: "1" } });
      }
      if (op.entry_point === entry("identity", "get_identity")) {
        const { account } = decode<{ account: string }>("identity.get_identity_arguments", bytesOf(op.args));
        return account === friend.account ? readResult("identity.get_identity_result", { value: { account, owner: account, encryption_key: friend.encryption.publicKey, key_version: 1 } }) : undefined;
      }
      if (op.entry_point === entry("publications", "get_author_state")) return readResult("publications.get_author_state_result", { value: { next_sequence: state.sequence, post_count: "0" } });
      if (op.entry_point === entry("publications", "get_post_by_idempotency_key") && state.existing) return readResult("publications.get_post_by_idempotency_key_result", { value: { post_id: state.existing } });
      return undefined;
    },
  });
  const protocol = new ProtocolClient({ rpc: provider, deployment });
  const indexer = new IndexerClient({
    baseUrl: "https://indexer.test",
    fetch: fakeIndexerFetch({
      [`/v1/keys/${me}`]: { items: [] },
      [`/v1/graph/${me}`]: { account: me, friends: [{ account: friend.account, since: "1", nonce: "1" }], pendingIncoming: [], pendingOutgoing: [], followers: [], following: [], blocked: [], audienceEpoch: 1 },
    }),
  });
  return { protocol, indexer, provider, state };
}

describe("publishDraft", () => {
  it("does not publish a preview encrypted before a friend removal", async () => {
    const session = await openSession();
    const { protocol, indexer, provider, state } = chainFor(session.identity.account);
    const deps: PublishDeps = { session, protocol, indexer, payment: "self-only" };
    const draft = newDraft(session.identity.account, { text: "after removal", audience: AUDIENCE.FRIENDS, mediaUrls: [] });
    const preview = await planDraft(deps, { draft });
    state.epoch++;
    await expect(publishDraft(deps, { draft }, preview)).rejects.toThrow("audience changed");
    expect(provider.sent).toHaveLength(0);
    expect(await listDrafts(session)).toHaveLength(1);
  });
  it("persists the attempt before anything is submitted, so a crash cannot lead to a duplicate", async () => {
    const session = await openSession();
    const { protocol, indexer } = chainFor(session.identity.account);
    const draft = newDraft(session.identity.account, { text: "hello", audience: AUDIENCE.EVERYONE, mediaUrls: [] });
    let seenDuringSubmit: string[] = [];
    const deps: PublishDeps = {
      session,
      protocol,
      indexer,
      payment: "self-only",
      submit: async () => {
        seenDuringSubmit = (await listDrafts(session)).map((d) => `${d.id}:${d.state}`);
        throw new Error("tab closed"); // simulate a crash / reload while the transaction is in flight
      },
    };
    await expect(publishDraft(deps, { draft })).rejects.toThrow("tab closed");
    expect(seenDuringSubmit).toEqual([`${draft.id}:submitting`]);
    const after = await listDrafts(session);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: draft.id, attemptId: draft.attemptId, state: "failed", lastError: "tab closed" });
  });

  it("removes the record and remembers the epoch key and its recipients after a successful friends-only publish", async () => {
    const session = await openSession();
    const me = session.identity.account;
    const { protocol, indexer, provider } = chainFor(me);
    const draft = newDraft(me, { text: "for friends", audience: AUDIENCE.FRIENDS, mediaUrls: [] });
    const outcome = await publishDraft({ session, protocol, indexer, payment: "self-only" }, { draft });
    expect(outcome.reconciled).toBe(false);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.transaction.operations).toHaveLength(2);
    expect(await listDrafts(session)).toEqual([]);
    const entry = session.keys.trusted({ author: me, audienceId: new Uint8Array(0), epoch: 1 });
    expect(entry).toBeDefined();
    expect(entry!.recipients.sort()).toEqual([me, friend.account].sort());
  });
});


describe("background publication", () => {
  it("returns after encrypted saving, keeps both rapid posts, and prepares the next sequence only after the first confirms", async () => {
    const session = await openSession();
    const { protocol, indexer, state } = chainFor(session.identity.account);
    const first = newDraft(session.identity.account, { text: "first", audience: 0, mediaUrls: [] });
    const second = newDraft(session.identity.account, { text: "second", audience: 0, mediaUrls: [] });
    const sequences: string[] = [];
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const deps: PublishDeps = { session, protocol, indexer, payment: "self-only", submit: async (ctx, operations, options) => {
      const publish = operations.at(-1)!.call_contract!;
      const args = decode<{ sequence: string }>("publications.publish_arguments", bytesOf(publish.args));
      sequences.push(args.sequence);
      if (sequences.length === 1) await hold;
      const result = await submitAction(ctx, operations, options);
      state.sequence = "2";
      return result;
    } };
    const accepted = startPublication(deps, { draft: first });
    expect(startPublication(deps, { draft: first })).toBe(accepted);
    await accepted;
    await startPublication(deps, { draft: second });
    await vi.waitFor(() => expect(sequences).toEqual(["1"]));
    expect((await listDrafts(session)).map(d => d.text).sort()).toEqual(["first", "second"]);
    release();
    await Promise.all([waitForPublication(deps, first.id), waitForPublication(deps, second.id)]);
    expect(sequences).toEqual(["1", "2"]);
    expect((await listDrafts(session)).map(d => d.state)).toEqual(["published", "published"]);
  });

  it("recovers a private post and its reading key after an unknown outcome without resubmitting", async () => {
    const session = await openSession();
    const { protocol, indexer, state, provider } = chainFor(session.identity.account);
    const draft = newDraft(session.identity.account, { text: "private retry", audience: AUDIENCE.FRIENDS, mediaUrls: [] });
    const submit = vi.fn(async () => { const error = new Error("confirmation timed out"); error.name = "TransactionOutcomeUnknownError"; throw error; });
    const deps: PublishDeps = { session, protocol, indexer, payment: "self-only", background: true, submit };
    await startPublication(deps, { draft });
    await waitForPublication(deps, draft.id);
    const saved = (await listDrafts(session))[0]!;
    expect(saved.state).toBe("unknown");
    expect(saved.publication?.epochKey).toBeTruthy();
    state.existing = bytesOf(saved.publication!.postId);
    await reconcileDraft(deps, saved);
    expect((await listDrafts(session))[0]?.state).toBe("published");
    expect(session.keys.trusted({ author: draft.account, audienceId: new Uint8Array(0), epoch: 1 })?.key).toEqual(bytesOf(saved.publication!.epochKey!));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(provider.sent).toHaveLength(0);
  });

  it("keeps concurrent encrypted draft writes and resumes attachment metadata", async () => {
    const session = await openSession();
    const { protocol, indexer } = chainFor(session.identity.account);
    const drafts = Array.from({ length: 5 }, (_, i) => newDraft(session.identity.account, { text: `draft ${i}`, audience: 0, mediaUrls: [] }));
    await Promise.all(drafts.map(d => saveDraft(session, d)));
    expect(await listDrafts(session)).toHaveLength(5);
    const media = [{ url: "https://example.test/image.png", mime: "image/png", size: 12, contentHash: new Uint8Array(32).fill(4) }];
    const deps: PublishDeps = { session, protocol, indexer, payment: "self-only" };
    await startPublication(deps, { draft: drafts[0]!, media });
    await waitForPublication(deps, drafts[0]!.id);
    const saved = (await listDrafts(session)).find(d => d.id === drafts[0]!.id)!;
    expect(saved.media?.[0]?.url).toBe(media[0]!.url);
    expect(bytesOf(saved.media![0]!.contentHash)).toEqual(media[0]!.contentHash);
    expect(saved.state).toBe("published");
  });
  it("persists private image keys in the encrypted draft and resumes them after an interrupted submit", async () => {
    const session = await openSession(), { protocol,indexer } = chainFor(session.identity.account);
    const encrypted = encryptMedia(new Uint8Array([1,2,3]));
    const media = [{ url: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqw4j4k2pm",mime: "image/jpeg",size: encrypted.ciphertext.length,contentHash: encrypted.contentHash,encryption: { key: toBase64url(encrypted.key),nonce: toBase64url(encrypted.nonce) } }];
    const draft = newDraft(session.identity.account,{ text: "",audience: AUDIENCE.FRIENDS,mediaUrls: [] });
    const deps: PublishDeps = { session,protocol,indexer,payment: "self-only",submit: async () => { throw new Error("connection lost"); } };
    await startPublication(deps,{ draft,media }); await waitForPublication(deps,draft.id);
    const saved = (await listDrafts(session))[0]!;
    expect(saved.state).toBe("failed"); expect(saved.media![0]!.encryption).toEqual(media[0]!.encryption);
    const retry = await planDraft(deps,{ draft: saved });
    expect(protocol.contracts.decodeOperation(retry.operations.at(-1)!)!.args.media).toEqual([]);
  });
  it("retries the identical private payload after a timeout and holds later posts until the outcome is known", async () => {
    const session = await openSession();
    const { protocol, indexer } = chainFor(session.identity.account);
    const first = newDraft(session.identity.account, { text: "uncertain private", audience: AUDIENCE.FRIENDS, mediaUrls: [] });
    const second = newDraft(session.identity.account, { text: "later private", audience: AUDIENCE.FRIENDS, mediaUrls: [] });
    const submit = vi.fn<NonNullable<PublishDeps["submit"]>>().mockImplementationOnce(async () => {
      const error = new Error("confirmation timed out"); error.name = "TransactionOutcomeUnknownError"; throw error;
    }).mockImplementation(submitAction);
    const deps: PublishDeps = { session, protocol, indexer, payment: "self-only", background: true, submit };
    await startPublication(deps, { draft: first }); await waitForPublication(deps, first.id);
    const uncertain = (await listDrafts(session))[0]!;
    await startPublication(deps, { draft: second }); await waitForPublication(deps, second.id);
    expect(submit).toHaveBeenCalledTimes(1);
    expect((await listDrafts(session)).find(d => d.id === second.id)?.state).toBe("queued");
    await startPublication(deps, { draft: uncertain }); await waitForPublication(deps, first.id);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]![1]).toEqual(submit.mock.calls[0]![1]);
    expect(session.keys.trusted({ author: first.account, audienceId: new Uint8Array(0), epoch: 1 })?.key).toEqual(bytesOf(uncertain.publication!.epochKey!));
    expect((await listDrafts(session)).find(d => d.id === first.id)?.publication?.operations).toBeUndefined();
  });

  it("does not send a queued publication after the vault locks", async () => {
    const session = await openSession();
    const { protocol, indexer, provider } = chainFor(session.identity.account);
    let unlocked = true;
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const deps: PublishDeps = { session, protocol, indexer, payment: "self-only", assertActive: () => { if (!unlocked) throw new Error("Unlock your account"); }, submit: async (ctx, ops, options) => { await hold; return submitAction(ctx, ops, options); } };
    const draft = newDraft(session.identity.account, { text: "locked", audience: 0, mediaUrls: [] });
    await startPublication(deps, { draft });
    unlocked = false; release();
    await waitForPublication(deps, draft.id);
    expect(provider.sent).toHaveLength(0);
    expect((await listDrafts(session))[0]?.state).toBe("failed");
  });

  it("reconciles edits through their saved attempt instead of publishing a second version", async () => {
    const session = await openSession();
    const { protocol, indexer, state, provider } = chainFor(session.identity.account);
    state.existing = new Uint8Array(32).fill(8);
    const draft = { ...newDraft(session.identity.account, { text: "edit", audience: 0, mediaUrls: [], edit: { postId: "unused", previousVersion: "unused", versionNumber: 2 } }), state: "unknown" as const };
    const outcome = await publishDraft({ session, protocol, indexer, payment: "self-only" }, { draft });
    expect(outcome.reconciled).toBe(true);
    expect(provider.sent).toHaveLength(0);
  });
});
