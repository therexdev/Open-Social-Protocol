// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AUDIENCE, ProtocolClient, RELATIONSHIP_STATUS, buildKeyPackageSet, decode, decryptContent, encode, encryptContent, identityFromSeed, openEpochKeyFromSet, parseKeyPackageSet, toBase64url, type Identity } from "@osp/sdk";
import { KeyStore } from "../../api/keystore";
import type { SealedKeyView } from "../../api/indexer";
import { fakeBlockReceipt, fakeProvider, fixtureDeployment, readResult } from "../../testing/fixtures";
import type { SubmitContext } from "../../tx/submit";
import { bytesOf } from "../../util/bytes";
import { acceptFriend, requestFriend } from "./actions";
import { syncFriendKeys } from "./syncKeys";

const alice = identityFromSeed(new Uint8Array(32).fill(10));
const bob = identityFromSeed(new Uint8Array(32).fill(20));
const stranger = identityFromSeed(new Uint8Array(32).fill(30));
const deployment = fixtureDeployment();
const txId = "0x1220" + "11".repeat(32);
const blockId = "0x1220" + "22".repeat(32);
const ref = (me: Identity, epoch = 0) => ({ author: me.account, audienceId: new Uint8Array(0), epoch });

function setup(me = alice, peer = bob) {
  const state = { status: RELATIONSHIP_STATUS.PENDING as number, epoch: 0, fail: false, chainDown: false, candidates: [peer.account], items: [] as SealedKeyView[] };
  const probe = new ProtocolClient({ rpc: fakeProvider(), deployment });
  const entry = (contract: "relationships" | "identity", method: string) => probe.contracts.method(contract, method).entry_point;
  const blocks: NonNullable<Parameters<typeof fakeProvider>[0]>["blocks"] = {};
  const provider = fakeProvider({
    transactions: { [txId]: { transaction: { id: txId }, containing_blocks: [blockId] } },
    blocks,
    onRead: (op) => {
      if (state.chainDown) throw new Error("network unavailable");
      if (op.entry_point === entry("relationships", "get_audience")) return readResult("relationships.get_audience_result", { value: { epoch: state.epoch, updated_at: "1" } });
      if (op.entry_point === entry("relationships", "get_relationship")) {
        const { a, b } = decode<{ a: string; b: string }>("relationships.get_relationship_arguments", bytesOf(op.args));
        return readResult("relationships.get_relationship_result", { value: { a, b, status: b === peer.account ? state.status : RELATIONSHIP_STATUS.INACTIVE, requester: me.account, nonce: "2", updated_at: "1" } });
      }
      if (op.entry_point === entry("identity", "get_identity")) {
        const { account } = decode<{ account: string }>("identity.get_identity_arguments", bytesOf(op.args));
        const person = [alice, bob, stranger].find((p) => p.account === account);
        return person ? readResult("identity.get_identity_result", { value: { account, owner: account, encryption_key: person.encryption.publicKey, key_version: 1 } }) : undefined;
      }
      return undefined;
    },
    onSend: () => state.fail ? { reverted: true } : {},
  });
  const client = new ProtocolClient({ rpc: provider, deployment });
  const ctx: SubmitContext = { client, signer: me.signer, payment: "self-only" };
  const keys = new KeyStore();
  const indexer = {
    graph: async () => ({ friends: state.candidates.map((account) => ({ account })) }),
    keys: async () => state.items,
  };
  return { ctx, me, keys, indexer, state, provider, blocks };
}

function openedKey(s: ReturnType<typeof setup>, reader: Identity) {
  const op = s.provider.sent.at(-1)!.transaction.operations!.at(-1)!;
  const decoded = s.ctx.client.contracts.decodeOperation(op)!;
  expect(decoded.method).toBe("distribute_keys");
  return openEpochKeyFromSet(parseKeyPackageSet(decoded.args.packages as Uint8Array), reader.account, reader.encryption.secretKey)!;
}

function coldKey(s: ReturnType<typeof setup>, key: Uint8Array) {
  const { bytes, set } = buildKeyPackageSet({ author: s.me.account, epoch: 0, epochKey: key, recipients: [{ address: s.me.account, publicKey: s.me.encryption.publicKey, keyVersion: 1 }] });
  s.state.items = [{ author: s.me.account, audienceId: "", epoch: 0, recipient: s.me.account, recipientKeyVersion: 1, sealedKey: toBase64url(encode("osp.envelope.sealed_key", set.keys[0] as unknown as Record<string, unknown>)), blockHeight: "120", txId }];
  s.blocks![blockId] = { block_id: blockId, block_height: "120", receipt: fakeBlockReceipt(txId, [{ source: deployment.contracts.publications.address, name: "osp.publications.keys_distributed", data: encode("publications.keys_distributed_event", { author: s.me.account, audience_id: new Uint8Array(0), epoch: 0, packages: bytes, timestamp: "1" }) }]) };
}

describe("mutual friends-only access", () => {
  it("opens both pre-existing posts after A requests, B accepts, and A next syncs without posting again", async () => {
    const a = setup(alice, bob);
    const b = setup(bob, alice);
    const aKey = new Uint8Array(32).fill(1);
    const bKey = new Uint8Array(32).fill(2);
    await a.keys.put(ref(alice), aKey, { recipients: [alice.account] });
    await b.keys.put(ref(bob), bKey, { recipients: [bob.account] });
    const aad = (me: Identity) => ({ chainId: deployment.chainId, author: me.account, audience: AUDIENCE.FRIENDS, epoch: 0, versionNumber: 1 });
    const aPost = encryptContent({ content: { version: 1, text: "Alice's earlier post" }, aad: aad(alice), epochKey: aKey });
    const bPost = encryptContent({ content: { version: 1, text: "Bob's earlier post" }, aad: aad(bob), epochKey: bKey });
    await requestFriend(a.ctx, bob.account);
    expect(a.provider.sent[0]!.transaction.operations).toHaveLength(1);
    expect(await syncFriendKeys(a)).toEqual([]); // Pending requests never get a key.
    expect(a.provider.sent).toHaveLength(1);
    await acceptFriend(b.ctx, alice.account, { keys: b.keys });
    expect(decryptContent({ envelope: bPost.envelope, epochKey: openedKey(b, alice), aad: aad(bob) }).text).toBe("Bob's earlier post");
    a.state.status = b.state.status = RELATIONSHIP_STATUS.ACTIVE;
    expect(await syncFriendKeys(a)).toEqual([bob.account]);
    expect(decryptContent({ envelope: aPost.envelope, epochKey: openedKey(a, bob), aad: aad(alice) }).text).toBe("Alice's earlier post");
    expect(await syncFriendKeys(a)).toEqual([]);
    expect(await syncFriendKeys(b)).toEqual([]);
    expect(a.provider.sent).toHaveLength(2);
    expect(b.provider.sent).toHaveLength(1);
  });

  it("restores both old posts after removal, reversed request, re-acceptance and cold device recovery", async () => {
    const a = setup(alice, bob), b = setup(bob, alice);
    const aKey = new Uint8Array(32).fill(41), bKey = new Uint8Array(32).fill(42);
    const aad = (me: Identity) => ({ chainId: deployment.chainId, author: me.account, audience: AUDIENCE.FRIENDS, epoch: 0, versionNumber: 1 });
    const aPost = encryptContent({ content: { version: 1, text: "Alice old history" }, aad: aad(alice), epochKey: aKey });
    const bPost = encryptContent({ content: { version: 1, text: "Bob old history" }, aad: aad(bob), epochKey: bKey });
    // Epoch zero was never reciprocally delivered. Both vault caches are empty after restore.
    coldKey(a, aKey); coldKey(b, bKey);
    a.state.epoch = b.state.epoch = 1;
    a.state.status = b.state.status = RELATIONSHIP_STATUS.INACTIVE;
    expect(await syncFriendKeys(a)).toEqual([]);
    expect(await syncFriendKeys(b)).toEqual([]);
    await requestFriend(b.ctx, alice.account);
    a.state.status = b.state.status = RELATIONSHIP_STATUS.PENDING;
    expect(await syncFriendKeys(b)).toEqual([]);
    await acceptFriend(a.ctx, bob.account, { keys: a.keys, me: alice, source: a.indexer });
    a.state.status = b.state.status = RELATIONSHIP_STATUS.ACTIVE;
    expect(await syncFriendKeys(a)).toEqual([bob.account]);
    expect(await syncFriendKeys(b)).toEqual([alice.account]);
    expect(decryptContent({ envelope: aPost.envelope, epochKey: openedKey(a, bob), aad: aad(alice) }).text).toBe("Alice old history");
    expect(decryptContent({ envelope: bPost.envelope, epochKey: openedKey(b, alice), aad: aad(bob) }).text).toBe("Bob old history");
    const sent = a.provider.sent.length + b.provider.sent.length;
    await syncFriendKeys(a); await syncFriendKeys(b);
    expect(a.provider.sent.length + b.provider.sent.length).toBe(sent);
  });

  it("resumes long histories in bounded passes without dropping old periods", async () => {
    const s = setup(); s.state.epoch = 17; s.state.status = RELATIONSHIP_STATUS.ACTIVE;
    for (let epoch = 0; epoch <= 17; epoch++) await s.keys.put(ref(alice, epoch), new Uint8Array(32).fill(epoch + 1));
    await syncFriendKeys(s);
    expect(s.provider.sent).toHaveLength(16);
    await syncFriendKeys(s);
    expect(s.provider.sent).toHaveLength(18);
    for (let epoch = 0; epoch <= 17; epoch++) expect(s.keys.recipients(ref(alice, epoch))).toContain(bob.account);
  });

  it("reports an unavailable indexer instead of treating historical keys as absent", async () => {
    const s = setup(); s.state.status = RELATIONSHIP_STATUS.ACTIVE;
    vi.spyOn(s.indexer, "keys").mockRejectedValue(new Error("offline"));
    await expect(syncFriendKeys(s)).rejects.toThrow("could not be verified");
    expect(s.provider.sent).toHaveLength(0);
  });

  it("recovers and verifies the author's key on a restored device, for both sync and acceptance", async () => {
    for (const accepting of [false, true]) {
      const s = setup();
      s.state.status = accepting ? RELATIONSHIP_STATUS.PENDING : RELATIONSHIP_STATUS.ACTIVE;
      const key = new Uint8Array(32).fill(4);
      coldKey(s, key);
      if (accepting) await acceptFriend(s.ctx, bob.account, { keys: s.keys, me: alice, source: s.indexer });
      else expect(await syncFriendKeys(s)).toEqual([bob.account]);
      expect(openedKey(s, bob)).toEqual(key);
      expect(s.keys.trusted(ref(alice))?.key).toEqual(key);
    }
  });

  it("does not trust an indexer's friend list, share unverified keys, or share with removed friends", async () => {
    const s = setup();
    s.state.status = RELATIONSHIP_STATUS.INACTIVE;
    s.state.candidates.push(stranger.account);
    await s.keys.put(ref(alice), new Uint8Array(32).fill(5));
    expect(await syncFriendKeys(s)).toEqual([]);
    expect(s.provider.sent).toHaveLength(0);
    s.state.status = RELATIONSHIP_STATUS.ACTIVE;
    s.state.epoch = 1;
    expect(await syncFriendKeys(s)).toEqual([bob.account]); // history belongs to current friends too
    s.keys.remember(ref(alice, 1), new Uint8Array(32).fill(6));
    expect(await syncFriendKeys(s)).toEqual([]);
    expect(s.provider.sent).toHaveLength(1);
  });

  it("fails closed when chain verification fails and only records recipients after a successful transaction", async () => {
    const s = setup();
    s.state.status = RELATIONSHIP_STATUS.ACTIVE;
    await s.keys.put(ref(alice), new Uint8Array(32).fill(5));
    s.state.chainDown = true;
    await expect(syncFriendKeys(s)).rejects.toThrow();
    expect(s.provider.sent).toHaveLength(0);
    s.state.chainDown = false;
    s.state.fail = true;
    await expect(syncFriendKeys(s)).rejects.toThrow();
    expect(s.keys.recipients(ref(alice))).not.toContain(bob.account);
    s.state.fail = false;
    expect(await syncFriendKeys(s)).toEqual([bob.account]);
    expect(s.keys.recipients(ref(alice))).toContain(bob.account);
  });

  it("honors sponsors-only settings instead of spending the author's Mana", async () => {
    const s = setup();
    s.state.status = RELATIONSHIP_STATUS.ACTIVE;
    s.ctx.payment = "sponsor-only";
    await s.keys.put(ref(alice), new Uint8Array(32).fill(5));
    await expect(syncFriendKeys(s)).rejects.toThrow("No sponsor");
    expect(s.provider.sent).toHaveLength(0);
  });

  it("cancels before signing when locked or when a removal rotates the epoch during reads", async () => {
    for (const lock of [false, true]) {
      const s = setup();
      s.state.status = RELATIONSHIP_STATUS.ACTIVE;
      await s.keys.put(ref(alice), new Uint8Array(32).fill(5));
      let current = true;
      vi.spyOn(s.indexer, "graph").mockImplementation(async () => {
        if (lock) current = false;
        else s.state.epoch = 1;
        return { friends: [{ account: bob.account }] };
      });
      expect(await syncFriendKeys({ ...s, isCurrent: () => current })).toEqual([]);
      expect(s.provider.sent).toHaveLength(0);
    }
  });

  it("deduplicates overlapping synchronization runs", async () => {
    const s = setup();
    s.state.status = RELATIONSHIP_STATUS.ACTIVE;
    await s.keys.put(ref(alice), new Uint8Array(32).fill(5));
    await Promise.all([syncFriendKeys(s), syncFriendKeys(s)]);
    expect(s.provider.sent).toHaveLength(1);
  });
});
