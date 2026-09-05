import { describe, expect, it } from "vitest";
import { AUDIENCE, LIFECYCLE, buildKeyPackageSet, encode, encryptContent, identityFromSeed, newEpochKey, postId, toBase58, toBase64url } from "@osp/sdk";
import { KeyStore } from "./keystore";
import { openPost } from "./decrypt";
import type { PostView, SealedKeyView } from "./indexer";
import { HARBINGER_CHAIN_ID } from "../testing/fixtures";

const seed = (label: string) => new Uint8Array(32).map((_, i) => (label.charCodeAt(i % label.length) + i) & 0xff);
const author = identityFromSeed(seed("author"));
const friend = identityFromSeed(seed("friend"));
const stranger = identityFromSeed(seed("stranger"));
const chainId = HARBINGER_CHAIN_ID;

function makePost(overrides: Partial<PostView> & { envelope: string; audience: number; epoch: number; contentHash: string; postId: string }): PostView {
  return {
    author: author.account,
    sequence: "1",
    versionNumber: 1,
    previousVersion: "",
    audienceId: "",
    media: [],
    replyTo: "",
    state: LIFECYCLE.ACTIVE,
    stateReason: "",
    replacementId: "",
    createdAt: "1700000000000",
    updatedAt: "1700000000000",
    txId: "0x1220" + "11".repeat(32),
    blockHeight: "120",
    reactions: { total: 0, byType: {} },
    replyCount: 0,
    versions: [],
    labels: [],
    ...overrides,
  };
}

function friendsPost(epoch: number) {
  const epochKey = newEpochKey();
  const aad = { chainId, author: author.account, audience: AUDIENCE.FRIENDS, epoch, versionNumber: 1 };
  const { bytes, contentHash } = encryptContent({ content: { version: 1, text: "only for friends" }, aad, epochKey });
  const id = postId({ chainId, author: author.account, sequence: 1, contentHash });
  const { set } = buildKeyPackageSet({
    author: author.account,
    epoch,
    epochKey,
    recipients: [
      { address: author.account, publicKey: author.encryption.publicKey, keyVersion: 1 },
      { address: friend.account, publicKey: friend.encryption.publicKey, keyVersion: 1 },
    ],
  });
  const items: SealedKeyView[] = set.keys.map((key) => ({
    author: author.account,
    audienceId: "",
    epoch,
    recipient: toBase58(key.recipient),
    recipientKeyVersion: 1,
    sealedKey: toBase64url(encode("osp.envelope.sealed_key", key as unknown as Record<string, unknown>)),
    blockHeight: "110",
    txId: "0x1220" + "22".repeat(32),
  }));
  const post = makePost({ envelope: toBase64url(bytes), audience: AUDIENCE.FRIENDS, epoch, contentHash: toBase64url(contentHash), postId: toBase64url(id) });
  return { post, items, epochKey };
}

function source(items: SealedKeyView[]) {
  return {
    async keys(account: string, filter: { author?: string; epoch?: number }) {
      return items.filter((i) => i.recipient === account && (filter.author === undefined || i.author === filter.author) && (filter.epoch === undefined || i.epoch === filter.epoch));
    },
  };
}

describe("post decryption pipeline", () => {
  it("shows everyone posts to anyone, even without a session", async () => {
    const { bytes, contentHash } = encryptContent({ content: { version: 1, text: "hello world" } });
    const post = makePost({ envelope: toBase64url(bytes), audience: AUDIENCE.EVERYONE, epoch: 0, contentHash: toBase64url(contentHash), postId: toBase64url(postId({ chainId, author: author.account, sequence: 1, contentHash })) });
    const opened = await openPost(post, { chainId });
    expect(opened.status).toBe("plain");
    if (opened.status === "plain") expect(opened.content.text).toBe("hello world");
  });

  it("decrypts a friends-only post for a recipient of the sealed key", async () => {
    const { post, items } = friendsPost(3);
    const keys = new KeyStore();
    const me = { account: friend.account, seed: friend.seed, encryption: friend.encryption };
    const opened = await openPost(post, { chainId, keys, me, keySource: source(items) });
    expect(opened.status).toBe("decrypted");
    if (opened.status === "decrypted") expect(opened.content.text).toBe("only for friends");
    // cached afterwards: no key source needed
    const again = await openPost(post, { chainId, keys, me });
    expect(again.status).toBe("decrypted");
    expect(keys.size).toBe(1);
  });

  it("decrypts for the author from the self-addressed sealed key", async () => {
    const { post, items } = friendsPost(1);
    const keys = new KeyStore();
    const opened = await openPost(post, { chainId, keys, me: { account: author.account, seed: author.seed, encryption: author.encryption }, keySource: source(items) });
    expect(opened.status).toBe("decrypted");
  });

  it("reports a no-key state for accounts without a sealed key and locked without a session", async () => {
    const { post, items } = friendsPost(2);
    const keys = new KeyStore();
    const opened = await openPost(post, { chainId, keys, me: { account: stranger.account, seed: stranger.seed, encryption: stranger.encryption }, keySource: source(items) });
    expect(opened.status).toBe("no-key");
    if (opened.status === "no-key") expect(opened.message).toMatch(/do not have the key/);
    const locked = await openPost(post, { chainId });
    expect(locked.status).toBe("locked");
  });

  it("fails cleanly when the epoch key does not match the envelope", async () => {
    const { post } = friendsPost(4);
    const keys = new KeyStore();
    await keys.put({ author: author.account, audienceId: new Uint8Array(0), epoch: 4 }, newEpochKey());
    const opened = await openPost(post, { chainId, keys, me: { account: friend.account, seed: friend.seed, encryption: friend.encryption } });
    expect(opened.status).toBe("error");
  });

  it("renders tombstones without touching the envelope", async () => {
    const { post } = friendsPost(5);
    const opened = await openPost({ ...post, state: LIFECYCLE.DELETED, stateReason: "deleted by author" }, { chainId });
    expect(opened.status).toBe("tombstone");
  });
});

describe("sealed keys served by the indexer are untrusted until the chain confirms them", () => {
  const friendId = { account: friend.account, seed: friend.seed, encryption: friend.encryption };
  const ref = (epoch: number) => ({ author: author.account, audienceId: new Uint8Array(0), epoch });

  it("keeps a key in memory only when its provenance cannot be checked", async () => {
    const { post, items } = friendsPost(6);
    const keys = new KeyStore();
    const opened = await openPost(post, { chainId, keys, me: friendId, keySource: source(items), verify: async () => ({ status: "unavailable", reason: "rpc down" }) });
    expect(opened.status).toBe("decrypted");
    expect(keys.entry(ref(6))?.trusted).toBe(false);
    expect(keys.trusted(ref(6))).toBeUndefined();
  });

  it("persists a key with the recipients the chain names once verified", async () => {
    const { post, items } = friendsPost(7);
    const keys = new KeyStore();
    const opened = await openPost(post, { chainId, keys, me: friendId, keySource: source(items), verify: async () => ({ status: "verified", recipients: [author.account, friend.account] }) });
    expect(opened.status).toBe("decrypted");
    expect(keys.trusted(ref(7))?.recipients).toEqual([author.account, friend.account]);
  });

  it("never adopts a sealed key the chain rejects", async () => {
    const { post, items } = friendsPost(8);
    const keys = new KeyStore();
    const opened = await openPost(post, { chainId, keys, me: friendId, keySource: source(items), verify: async () => ({ status: "rejected", reason: "not on chain" }) });
    expect(opened.status).toBe("no-key");
    expect(keys.has(ref(8))).toBe(false);
  });

  it("recovers from a poisoned cache by trying the other sealed copies and drops the bad one", async () => {
    const { post, items, epochKey } = friendsPost(9);
    const keys = new KeyStore();
    keys.remember(ref(9), newEpochKey()); // an unverified key that does not open the author's posts
    const opened = await openPost(post, { chainId, keys, me: friendId, keySource: source(items) });
    expect(opened.status).toBe("decrypted");
    expect(keys.get(ref(9)) && Buffer.from(keys.get(ref(9))!).toString("hex")).toBe(Buffer.from(epochKey).toString("hex"));
  });

  it("forgets an unverified key that does not open the post and keeps a trusted one", async () => {
    const { post } = friendsPost(10);
    const keys = new KeyStore();
    keys.remember(ref(10), newEpochKey());
    expect((await openPost(post, { chainId, keys, me: friendId })).status).toBe("error");
    expect(keys.has(ref(10))).toBe(false);
    await keys.put(ref(10), newEpochKey(), { recipients: [author.account] });
    expect((await openPost(post, { chainId, keys, me: friendId })).status).toBe("error");
    expect(keys.trusted(ref(10))).toBeDefined();
  });
});
