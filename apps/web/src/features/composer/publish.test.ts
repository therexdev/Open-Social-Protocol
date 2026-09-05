import { describe, expect, it } from "vitest";
import {
  AUDIENCE,
  RELATIONSHIP_STATUS,
  ProtocolClient,
  buildKeyPackageSet,
  decode,
  decryptContent,
  encode,
  identityFromSeed,
  idempotencyKey,
  newEpochKey,
  openEpochKeyFromSet,
  parseKeyPackageSet,
  postId,
  sealEpochKey,
  toBase58,
  toBase64url,
  toHex,
  type Identity,
} from "@osp/sdk";
import { KeyStore } from "../../api/keystore";
import { chainKeyVerifier } from "../../api/keyProvenance";
import { IndexerClient, type SealedKeyView } from "../../api/indexer";
import { decodeCallArgs, fakeBlockReceipt, fakeIndexerFetch, fakeProvider, fixtureDeployment, readResult, type FakeProviderOptions } from "../../testing/fixtures";
import { bytesOf } from "../../util/bytes";
import { buildPublishPlan, findExistingPost } from "./publish";

const seed = (label: string) => new Uint8Array(32).map((_, i) => (label.charCodeAt(i % label.length) * 7 + i) & 0xff);
const me = identityFromSeed(seed("me"));
const alice = identityFromSeed(seed("alice"));
const bob = identityFromSeed(seed("bob"));
const mallory = identityFromSeed(seed("mallory"));
const deployment = fixtureDeployment();

interface SetupOptions {
  epoch?: number;
  nextSequence?: string;
  existingPost?: Uint8Array;
  /** Accounts the chain records as active friends of `me` (default alice and bob). */
  friends?: string[];
  /** Registered identities the chain serves (default alice and bob). */
  identities?: Identity[];
  /** Candidate friends the indexer lists (default: the chain's friends). */
  indexerFriends?: string[];
  /** Extra indexer routes (profiles, sealed keys, ...). */
  routes?: Record<string, unknown>;
  chainDown?: boolean;
  provider?: Pick<FakeProviderOptions, "transactions" | "blocks">;
}

function setup(options: SetupOptions = {}) {
  const client = new ProtocolClient({ rpc: fakeProvider(), deployment });
  const entry = (contract: "relationships" | "publications" | "identity", method: string) => client.contracts.method(contract, method).entry_point;
  const friends = options.friends ?? [alice.account, bob.account];
  const identities = new Map((options.identities ?? [alice, bob]).map((i) => [i.account, i]));
  const provider = fakeProvider({
    ...options.provider,
    onRead: (op) => {
      const args = bytesOf(op.args);
      if (op.entry_point === entry("relationships", "get_audience")) return readResult("relationships.get_audience_result", { value: { epoch: options.epoch ?? 0, updated_at: "1" } });
      if (options.chainDown && (op.entry_point === entry("relationships", "get_relationship") || op.entry_point === entry("identity", "get_identity"))) throw new Error("ECONNREFUSED");
      if (op.entry_point === entry("relationships", "get_relationship")) {
        const { a, b } = decode<{ a: string; b: string }>("relationships.get_relationship_arguments", args);
        const peer = a === me.account ? b : a;
        if (!friends.includes(peer)) return undefined;
        return readResult("relationships.get_relationship_result", { value: { a, b, status: RELATIONSHIP_STATUS.ACTIVE, requester: peer, nonce: "2", updated_at: "1" } });
      }
      if (op.entry_point === entry("publications", "get_author_state")) return readResult("publications.get_author_state_result", { value: { next_sequence: options.nextSequence ?? "1", post_count: "0" } });
      if (op.entry_point === entry("publications", "get_post_by_idempotency_key")) {
        return options.existingPost ? readResult("publications.get_post_by_idempotency_key_result", { value: { post_id: options.existingPost } }) : undefined;
      }
      if (op.entry_point === entry("identity", "get_identity")) {
        const { account } = decode<{ account: string }>("identity.get_identity_arguments", args);
        const identity = identities.get(account);
        if (!identity) return undefined;
        return readResult("identity.get_identity_result", { value: { account, owner: account, encryption_key: identity.encryption.publicKey, key_version: 1 } });
      }
      return undefined;
    },
  });
  const chain = new ProtocolClient({ rpc: provider, deployment });
  const calls: string[] = [];
  const listed = options.indexerFriends ?? friends;
  const indexer = new IndexerClient({
    baseUrl: "https://indexer.test",
    fetch: fakeIndexerFetch(
      {
        [`/v1/graph/${me.account}`]: {
          account: me.account,
          friends: listed.map((account, i) => ({ account, since: String(i + 1), nonce: "1" })),
          pendingIncoming: [],
          pendingOutgoing: [],
          followers: [],
          following: [],
          blocked: [],
          audienceEpoch: options.epoch ?? 0,
        },
        ...options.routes,
      },
      calls,
    ),
  });
  return { chain, indexer, calls, provider, verify: chainKeyVerifier(chain) };
}

const ref = (epoch: number) => ({ author: me.account, audienceId: new Uint8Array(0), epoch });

/** A `/v1/keys/:me` item: `epochKey` sealed to `me` by `sealer` (the attacker or the author). */
function sealedItem(epochKey: Uint8Array, epoch: number, txId: string): SealedKeyView {
  const sealed = sealEpochKey({ author: me.account, epoch, epochKey, recipient: me.account, recipientPublicKey: me.encryption.publicKey, recipientKeyVersion: 1 });
  return { author: me.account, audienceId: "", epoch, recipient: me.account, recipientKeyVersion: 1, sealedKey: toBase64url(encode("osp.envelope.sealed_key", sealed as unknown as Record<string, unknown>)), blockHeight: "120", txId };
}

describe("buildPublishPlan", () => {
  it("builds [distribute_keys, publish] for a friends-only post with the current epoch", async () => {
    const { chain, indexer } = setup({ epoch: 3, nextSequence: "5" });
    const keys = new KeyStore();
    const attemptId = new Uint8Array(16).fill(7);
    const plan = await buildPublishPlan({ chain, indexer, me, keys, text: "secret hello", audience: AUDIENCE.FRIENDS, attemptId, createdAt: 1700000000000 });

    expect(plan.operations).toHaveLength(2);
    expect(plan.epoch).toBe(3);
    expect(plan.sequence).toBe("5");
    expect(plan.epochKey).toBeDefined();
    expect(plan.recipients).toEqual([alice.account, bob.account]);
    expect(plan.skipped).toEqual([]);

    const distribute = chain.contracts.decodeOperation(plan.operations[0]!);
    expect(distribute?.contract).toBe("publications");
    expect(distribute?.method).toBe("distribute_keys");
    expect(distribute?.args.author).toBe(me.account);
    expect(distribute?.args.epoch).toBe(3);
    const set = parseKeyPackageSet(distribute!.args.packages as Uint8Array);
    expect(set.epoch).toBe(3);
    expect(set.keys).toHaveLength(3);
    // alice, bob and the author can all open the epoch key
    for (const member of [me, alice, bob]) {
      const opened = openEpochKeyFromSet(set, member.account, member.encryption.secretKey);
      expect(opened && toHex(opened)).toBe(toHex(plan.epochKey!));
    }

    const publish = chain.contracts.decodeOperation(plan.operations[1]!);
    expect(publish?.method).toBe("publish");
    const args = publish!.args as { author: string; post_id: Uint8Array; sequence: string; audience: number; epoch: number; envelope: Uint8Array; content_hash: Uint8Array; idempotency_key: Uint8Array; previous_version: Uint8Array };
    expect(args.author).toBe(me.account);
    expect(args.sequence).toBe("5");
    expect(args.audience).toBe(AUDIENCE.FRIENDS);
    expect(args.epoch).toBe(3);
    expect(toHex(args.idempotency_key)).toBe(toHex(idempotencyKey(me.account, attemptId)));
    expect(toHex(args.post_id)).toBe(toHex(postId({ chainId: chain.chainId, author: me.account, sequence: "5", contentHash: args.content_hash })));
    expect(toHex(args.post_id)).toBe(toHex(plan.postId));
    expect(args.previous_version.length).toBe(0);
    // the envelope decrypts with the distributed key under the AAD the reader will rebuild
    const content = decryptContent({ envelope: args.envelope, epochKey: plan.epochKey, aad: { chainId: chain.chainId, author: me.account, audience: AUDIENCE.FRIENDS, epoch: 3, versionNumber: 1 } });
    expect(content.text).toBe("secret hello");
  });

  it("reuses a cached epoch key and hands it to the friend who does not hold it yet, in the same transaction", async () => {
    const { chain, indexer } = setup({ epoch: 2 });
    const keys = new KeyStore();
    const existing = new Uint8Array(32).fill(9);
    // bob became a friend after the key was distributed (accept_friend does not rotate the epoch)
    await keys.put(ref(2), existing, { recipients: [me.account, alice.account] });
    const plan = await buildPublishPlan({ chain, indexer, me, keys, text: "again", audience: AUDIENCE.FRIENDS, attemptId: toHex(new Uint8Array(16).fill(1)) });
    expect(plan.operations).toHaveLength(2);
    expect(plan.epochKey).toBeUndefined();
    expect(plan.recipients).toEqual([bob.account]);
    const distribute = chain.contracts.decodeOperation(plan.operations[0]!)!;
    expect(distribute.method).toBe("distribute_keys");
    const set = parseKeyPackageSet(distribute.args.packages as Uint8Array);
    expect(set.epoch).toBe(2);
    expect(set.keys).toHaveLength(1);
    expect(toBase58(set.keys[0]!.recipient)).toBe(bob.account);
    expect(toHex(openEpochKeyFromSet(set, bob.account, bob.encryption.secretKey)!)).toBe(toHex(existing));
    expect(openEpochKeyFromSet(set, alice.account, alice.encryption.secretKey)).toBeUndefined();
    const publish = chain.contracts.decodeOperation(plan.operations[1]!)!;
    expect(publish.method).toBe("publish");
    const content = decryptContent({ envelope: (publish.args as { envelope: Uint8Array }).envelope, epochKey: existing, aad: { chainId: chain.chainId, author: me.account, audience: AUDIENCE.FRIENDS, epoch: 2, versionNumber: 1 } });
    expect(content.text).toBe("again");
  });

  it("skips key distribution when every friend already holds the cached key", async () => {
    const { chain, indexer } = setup({ epoch: 2 });
    const keys = new KeyStore();
    const existing = new Uint8Array(32).fill(9);
    await keys.put(ref(2), existing, { recipients: [me.account, alice.account, bob.account] });
    const plan = await buildPublishPlan({ chain, indexer, me, keys, text: "again", audience: AUDIENCE.FRIENDS, attemptId: toHex(new Uint8Array(16).fill(1)) });
    expect(plan.operations).toHaveLength(1);
    expect(plan.epochKey).toBeUndefined();
    expect(plan.recipients).toEqual([]);
    expect(chain.contracts.decodeOperation(plan.operations[0]!)!.method).toBe("publish");
  });

  it("never reuses a legacy cached key without provenance for publishing", async () => {
    const { chain, indexer } = setup({ epoch: 2 });
    const keys = new KeyStore();
    keys.remember(ref(2), new Uint8Array(32).fill(9));
    const plan = await buildPublishPlan({ chain, indexer, me, keys, text: "again", audience: AUDIENCE.FRIENDS, attemptId: toHex(new Uint8Array(16).fill(1)) });
    expect(plan.epochKey).toBeDefined();
    expect(toHex(plan.epochKey!)).not.toBe(toHex(new Uint8Array(32).fill(9)));
    expect(plan.operations).toHaveLength(2);
  });

  it("takes friends and their encryption keys from the chain, never from the indexer", async () => {
    // The indexer lists mallory as a friend and serves a wrong key for alice; the chain knows better.
    const { chain, indexer } = setup({
      epoch: 1,
      indexerFriends: [alice.account, mallory.account, bob.account],
      routes: {
        [`/v1/profiles/${alice.account}`]: { account: alice.account, owner: alice.account, encryptionKey: toBase64url(mallory.encryption.publicKey), keyVersion: 1, profileHash: "", profileUri: "", protocolVersion: 1, deviceEpoch: 0, registeredAt: "1", updatedAt: "1", counts: { posts: 0, friends: 1, followers: 0, following: 0 } },
      },
    });
    const keys = new KeyStore();
    const plan = await buildPublishPlan({ chain, indexer, me, keys, text: "trusted", audience: AUDIENCE.FRIENDS, attemptId: new Uint8Array(16).fill(4) });
    expect(plan.recipients).toEqual([alice.account, bob.account]);
    const set = parseKeyPackageSet(chain.contracts.decodeOperation(plan.operations[0]!)!.args.packages as Uint8Array);
    expect(set.keys.map((k) => toBase58(k.recipient)).sort()).toEqual([me.account, alice.account, bob.account].sort());
    // alice's real secret opens her copy: it was sealed to the key the chain records, not the indexer's
    expect(toHex(openEpochKeyFromSet(set, alice.account, alice.encryption.secretKey)!)).toBe(toHex(plan.epochKey!));
    expect(openEpochKeyFromSet(set, mallory.account, mallory.encryption.secretKey)).toBeUndefined();
  });

  it("reports friends without a registered key instead of sealing to them", async () => {
    const { chain, indexer } = setup({ epoch: 1, identities: [alice] });
    const plan = await buildPublishPlan({ chain, indexer, me, keys: new KeyStore(), text: "x", audience: AUDIENCE.FRIENDS, attemptId: new Uint8Array(16).fill(4) });
    expect(plan.recipients).toEqual([alice.account]);
    expect(plan.skipped).toEqual([bob.account]);
  });

  it("fails closed when the chain cannot confirm the friends list", async () => {
    const { chain, indexer } = setup({ epoch: 1, chainDown: true });
    await expect(buildPublishPlan({ chain, indexer, me, keys: new KeyStore(), text: "x", audience: AUDIENCE.FRIENDS, attemptId: new Uint8Array(16).fill(4) })).rejects.toThrow(/could not confirm/);
  });

  it("does not reuse a sealed key from the indexer whose transaction is not on chain", async () => {
    const planted = new Uint8Array(32).fill(0x42);
    const txId = "0x1220" + "ab".repeat(32);
    const { chain, indexer, verify } = setup({ epoch: 4, routes: { [`/v1/keys/${me.account}`]: { items: [sealedItem(planted, 4, txId)] } }, provider: { transactions: {}, blocks: {} } });
    const keys = new KeyStore();
    const plan = await buildPublishPlan({ chain, indexer, me, keys, text: "fresh", audience: AUDIENCE.FRIENDS, attemptId: new Uint8Array(16).fill(5), verify });
    expect(plan.epochKey).toBeDefined();
    expect(toHex(plan.epochKey!)).not.toBe(toHex(planted));
    expect(keys.trusted(ref(4))).toBeUndefined();
  });

  it("refuses to publish when an existing sealed key cannot be verified because the chain is unreachable", async () => {
    const planted = new Uint8Array(32).fill(0x42);
    const txId = "0x1220" + "ab".repeat(32);
    // no `transactions` option: getTransactionsById rejects -> provenance unavailable
    const { chain, indexer, verify } = setup({ epoch: 4, routes: { [`/v1/keys/${me.account}`]: { items: [sealedItem(planted, 4, txId)] } } });
    await expect(buildPublishPlan({ chain, indexer, me, keys: new KeyStore(), text: "fresh", audience: AUDIENCE.FRIENDS, attemptId: new Uint8Array(16).fill(5), verify })).rejects.toThrow(/could not be verified/);
  });

  it("reuses the key verified from chain history and distributes it to friends the chain record does not name", async () => {
    const epochKey = newEpochKey();
    const txId = "0x1220" + "cd".repeat(32);
    const blockId = "0x1220" + "ef".repeat(32);
    // the author distributed the key (to itself and alice) from another device
    const { bytes: packages, set } = buildKeyPackageSet({
      author: me.account,
      epoch: 4,
      epochKey,
      recipients: [
        { address: me.account, publicKey: me.encryption.publicKey, keyVersion: 1 },
        { address: alice.account, publicKey: alice.encryption.publicKey, keyVersion: 1 },
      ],
    });
    const mine = set.keys.find((k) => toBase58(k.recipient) === me.account)!;
    const item: SealedKeyView = { author: me.account, audienceId: "", epoch: 4, recipient: me.account, recipientKeyVersion: 1, sealedKey: toBase64url(encode("osp.envelope.sealed_key", mine as unknown as Record<string, unknown>)), blockHeight: "120", txId };
    const event = encode("publications.keys_distributed_event", { author: me.account, audience_id: new Uint8Array(0), epoch: 4, packages, timestamp: "1" });
    const { chain, indexer, verify } = setup({
      epoch: 4,
      routes: { [`/v1/keys/${me.account}`]: { items: [item] } },
      provider: {
        transactions: { [txId]: { transaction: { id: txId }, containing_blocks: [blockId] } },
        blocks: { [blockId]: { block_id: blockId, block_height: "120", receipt: fakeBlockReceipt(txId, [{ source: deployment.contracts.publications.address, name: "osp.publications.keys_distributed", data: event }]) } },
      },
    });
    const keys = new KeyStore();
    const plan = await buildPublishPlan({ chain, indexer, me, keys, text: "same key", audience: AUDIENCE.FRIENDS, attemptId: new Uint8Array(16).fill(6), verify });
    expect(plan.epochKey).toBeUndefined();
    expect(plan.recipients).toEqual([bob.account]);
    const trusted = keys.trusted(ref(4));
    expect(trusted && toHex(trusted.key)).toBe(toHex(epochKey));
    expect(trusted?.recipients.sort()).toEqual([me.account, alice.account].sort());
    const publish = chain.contracts.decodeOperation(plan.operations[1]!)!;
    const content = decryptContent({ envelope: (publish.args as { envelope: Uint8Array }).envelope, epochKey, aad: { chainId: chain.chainId, author: me.account, audience: AUDIENCE.FRIENDS, epoch: 4, versionNumber: 1 } });
    expect(content.text).toBe("same key");
  });

  it("builds a plaintext publish for everyone and media refs", async () => {
    const { chain, indexer, calls } = setup();
    const keys = new KeyStore();
    const plan = await buildPublishPlan({
      chain,
      indexer,
      me,
      keys,
      text: "public post",
      audience: AUDIENCE.EVERYONE,
      attemptId: new Uint8Array(16).fill(2),
      media: [{ url: "https://cdn.example.org/a.png", mime: "image/png", size: 1234, contentHash: new Uint8Array(32).fill(4) }],
    });
    expect(plan.operations).toHaveLength(1);
    expect(calls).toEqual([]);
    const args = chain.contracts.decodeOperation(plan.operations[0]!)!.args as { epoch: number; media: Array<{ mime: string; locations: string[] }>; envelope: Uint8Array };
    // absent audience (everyone = 0): read without default filling, see decodeCallArgs
    expect(decodeCallArgs("publications.publish_arguments", plan.operations[0]!).audience ?? AUDIENCE.EVERYONE).toBe(AUDIENCE.EVERYONE);
    expect(args.media[0]?.mime).toBe("image/png");
    expect(args.media[0]?.locations).toEqual(["https://cdn.example.org/a.png"]);
    expect(decryptContent({ envelope: args.envelope }).text).toBe("public post");
  });

  it("edits publish a new version under the same post id with previous_version", async () => {
    const { chain, indexer } = setup();
    const keys = new KeyStore();
    const id = new Uint8Array(32).fill(5);
    const prev = new Uint8Array(32).fill(6);
    const plan = await buildPublishPlan({
      chain,
      indexer,
      me,
      keys,
      text: "edited",
      audience: AUDIENCE.EVERYONE,
      attemptId: new Uint8Array(16).fill(3),
      edit: { postId: toBase64url(id), previousVersion: toBase64url(prev), versionNumber: 2 },
    });
    const args = chain.contracts.decodeOperation(plan.operations[0]!)!.args as { post_id: Uint8Array; previous_version: Uint8Array; sequence: string };
    expect(toHex(args.post_id)).toBe(toHex(id));
    expect(toHex(args.previous_version)).toBe(toHex(prev));
    expect(args.sequence).toBe("0");
    expect(plan.versionNumber).toBe(2);
  });

  it("finds an existing post by idempotency key before any retry", async () => {
    const existing = new Uint8Array(32).fill(8);
    const { chain } = setup({ existingPost: existing });
    const found = await findExistingPost(chain, me.account, new Uint8Array(16).fill(7));
    expect(found && toHex(found)).toBe(toHex(existing));
    const { chain: fresh } = setup();
    expect(await findExistingPost(fresh, me.account, new Uint8Array(16).fill(7))).toBeUndefined();
  });

  it("rejects posts above the envelope limit", async () => {
    const { chain, indexer } = setup();
    await expect(buildPublishPlan({ chain, indexer, me, keys: new KeyStore(), text: "x".repeat(5000), audience: AUDIENCE.EVERYONE, attemptId: new Uint8Array(16) })).rejects.toThrow(/limit/);
  });
});
