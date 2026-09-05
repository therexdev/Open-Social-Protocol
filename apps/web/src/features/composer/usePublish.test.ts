// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AUDIENCE, ProtocolClient, RELATIONSHIP_STATUS, decode, identityFromSeed } from "@osp/sdk";
import { IndexerClient } from "../../api/indexer";
import { fakeIndexerFetch, fakeProvider, fixtureDeployment, readResult } from "../../testing/fixtures";
import { bytesOf } from "../../util/bytes";
import { unsupportedPasskey } from "../../vault/passkey";
import { memoryStorage } from "../../vault/storage";
import { createVaultStore, type Session } from "../../vault/store";
import { listDrafts, newDraft } from "./drafts";
import { publishDraft, type PublishDeps } from "./usePublish";

const deployment = fixtureDeployment();
const friend = identityFromSeed(new Uint8Array(32).fill(9));

async function openSession(): Promise<Session> {
  const vault = createVaultStore({ storage: memoryStorage(), kdf: { N: 1024, r: 8, p: 1 }, passkey: unsupportedPasskey });
  await vault.getState().init();
  await vault.getState().create("correct horse battery");
  return vault.getState().session!;
}

function chainFor(me: string) {
  const probe = new ProtocolClient({ rpc: fakeProvider(), deployment });
  const entry = (contract: "relationships" | "publications" | "identity", method: string) => probe.contracts.method(contract, method).entry_point;
  const provider = fakeProvider({
    onRead: (op) => {
      if (op.entry_point === entry("relationships", "get_audience")) return readResult("relationships.get_audience_result", { value: { epoch: 1, updated_at: "1" } });
      if (op.entry_point === entry("relationships", "get_relationship")) {
        const { a, b } = decode<{ a: string; b: string }>("relationships.get_relationship_arguments", bytesOf(op.args));
        return readResult("relationships.get_relationship_result", { value: { a, b, status: RELATIONSHIP_STATUS.ACTIVE, requester: b, nonce: "2", updated_at: "1" } });
      }
      if (op.entry_point === entry("identity", "get_identity")) {
        const { account } = decode<{ account: string }>("identity.get_identity_arguments", bytesOf(op.args));
        return account === friend.account ? readResult("identity.get_identity_result", { value: { account, owner: account, encryption_key: friend.encryption.publicKey, key_version: 1 } }) : undefined;
      }
      if (op.entry_point === entry("publications", "get_author_state")) return readResult("publications.get_author_state_result", { value: { next_sequence: "1", post_count: "0" } });
      return undefined;
    },
  });
  const protocol = new ProtocolClient({ rpc: provider, deployment });
  const indexer = new IndexerClient({
    baseUrl: "https://indexer.test",
    fetch: fakeIndexerFetch({
      [`/v1/graph/${me}`]: { account: me, friends: [{ account: friend.account, since: "1", nonce: "1" }], pendingIncoming: [], pendingOutgoing: [], followers: [], following: [], blocked: [], audienceEpoch: 1 },
    }),
  });
  return { protocol, indexer, provider };
}

describe("publishDraft", () => {
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
