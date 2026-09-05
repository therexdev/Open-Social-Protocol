import { describe, expect, it } from "vitest";
import {
  AUDIENCE,
  ProtocolClient,
  decryptContent,
  identityFromSeed,
  idempotencyKey,
  openEpochKeyFromSet,
  parseKeyPackageSet,
  postId,
  toBase64url,
  toHex,
} from "@osp/sdk";
import { KeyStore } from "../../api/keystore";
import { IndexerClient } from "../../api/indexer";
import { fakeIndexerFetch, fakeProvider, fixtureDeployment, readResult } from "../../testing/fixtures";
import { buildPublishPlan, findExistingPost } from "./publish";

const seed = (label: string) => new Uint8Array(32).map((_, i) => (label.charCodeAt(i % label.length) * 7 + i) & 0xff);
const me = identityFromSeed(seed("me"));
const alice = identityFromSeed(seed("alice"));
const bob = identityFromSeed(seed("bob"));
const deployment = fixtureDeployment();

function setup(options: { epoch?: number; nextSequence?: string; existingPost?: Uint8Array } = {}) {
  const client = new ProtocolClient({ rpc: fakeProvider(), deployment });
  const entry = (contract: "relationships" | "publications" | "identity", method: string) => client.contracts.method(contract, method).entry_point;
  const provider = fakeProvider({
    onRead: (op) => {
      if (op.entry_point === entry("relationships", "get_audience")) return readResult("relationships.get_audience_result", { value: { epoch: options.epoch ?? 0, updated_at: "1" } });
      if (op.entry_point === entry("publications", "get_author_state")) return readResult("publications.get_author_state_result", { value: { next_sequence: options.nextSequence ?? "1", post_count: "0" } });
      if (op.entry_point === entry("publications", "get_post_by_idempotency_key")) {
        return options.existingPost ? readResult("publications.get_post_by_idempotency_key_result", { value: { post_id: options.existingPost } }) : undefined;
      }
      if (op.entry_point === entry("identity", "get_identity")) return readResult("identity.get_identity_result", { value: { account: bob.account, owner: bob.account, encryption_key: bob.encryption.publicKey, key_version: 1 } });
      return undefined;
    },
  });
  const chain = new ProtocolClient({ rpc: provider, deployment });
  const calls: string[] = [];
  const indexer = new IndexerClient({
    baseUrl: "https://indexer.test",
    fetch: fakeIndexerFetch(
      {
        [`/v1/graph/${me.account}`]: { account: me.account, friends: [{ account: alice.account, since: "1", nonce: "1" }, { account: bob.account, since: "2", nonce: "1" }], pendingIncoming: [], pendingOutgoing: [], followers: [], following: [], blocked: [], audienceEpoch: 0 },
        [`/v1/profiles/${alice.account}`]: { account: alice.account, owner: alice.account, encryptionKey: toBase64url(alice.encryption.publicKey), keyVersion: 1, profileHash: "", profileUri: "", protocolVersion: 1, deviceEpoch: 0, registeredAt: "1", updatedAt: "1", counts: { posts: 0, friends: 1, followers: 0, following: 0 } },
        // bob is missing from the indexer: the chain fallback provides his key
      },
      calls,
    ),
  });
  return { chain, indexer, calls, provider };
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
    expect(plan.recipients).toEqual([me.account, alice.account, bob.account]);
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

  it("reuses a cached epoch key and skips key distribution", async () => {
    const { chain, indexer, calls } = setup({ epoch: 2 });
    const keys = new KeyStore();
    const existing = new Uint8Array(32).fill(9);
    await keys.put({ author: me.account, audienceId: new Uint8Array(0), epoch: 2 }, existing);
    const plan = await buildPublishPlan({ chain, indexer, me, keys, text: "again", audience: AUDIENCE.FRIENDS, attemptId: toHex(new Uint8Array(16).fill(1)) });
    expect(plan.operations).toHaveLength(1);
    expect(plan.epochKey).toBeUndefined();
    expect(calls.some((c) => c.startsWith("/v1/graph"))).toBe(false);
    const content = decryptContent({ envelope: (chain.contracts.decodeOperation(plan.operations[0]!)!.args as { envelope: Uint8Array }).envelope, epochKey: existing, aad: { chainId: chain.chainId, author: me.account, audience: AUDIENCE.FRIENDS, epoch: 2, versionNumber: 1 } });
    expect(content.text).toBe("again");
  });

  it("builds a plaintext publish for everyone and media refs", async () => {
    const { chain, indexer } = setup();
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
    const args = chain.contracts.decodeOperation(plan.operations[0]!)!.args as { audience: number; epoch: number; media: Array<{ mime: string; locations: string[] }>; envelope: Uint8Array };
    expect(args.audience).toBe(AUDIENCE.EVERYONE);
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
