/**
 * A scripted protocol history (test-only): registrations, a friend flow, public and friends
 * posts with real envelopes and sealed epoch keys, reactions, a reply, edits, lifecycle
 * changes, a community with a role and a label, a sponsor, registry entries, a device,
 * recovery, a block with audience rotation, and foreign / reverted events that must be ignored.
 */
import { createHash } from "node:crypto";
import {
  AUDIENCE,
  COMMUNITY_ROLE,
  LIFECYCLE,
  REACTION,
  Signer,
  buildKeyPackageSet,
  contentHash,
  encryptContent,
  identityFromSeed,
  idempotencyKey,
  postId,
  toBase64url,
  concat,
  u32be,
  utf8,
  type Deployment,
  type Rng,
} from "@osp/sdk";
import { ChainBuilder, foreignEvent, ospEvent, testDeployment, tx, type EventInput } from "./fake-chain.js";

export function sha256(text: string): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(text, "utf8").digest());
}

/** Deterministic byte stream: sha256(label || counter) blocks. */
export function deterministicRng(label: string): Rng {
  let counter = 0;
  return (length: number) => {
    const out = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const block = Uint8Array.from(createHash("sha256").update(concat(utf8(label), u32be(counter++))).digest());
      const n = Math.min(block.length, length - offset);
      out.set(block.subarray(0, n), offset);
      offset += n;
    }
    return out;
  };
}

export type Identity = ReturnType<typeof identityFromSeed>;

export interface HistoryPost {
  id: Uint8Array;
  idB64: string;
  envelope: Uint8Array;
  hash: Uint8Array;
  hashB64: string;
  sequence: string;
}

export interface History {
  deployment: Deployment;
  builder: ChainBuilder;
  chainId: string;
  actors: Record<"alice" | "bob" | "carol" | "dave", Identity>;
  posts: { p1: HistoryPost; p1v2: HistoryPost; p2: HistoryPost; p3: HistoryPost; p4: HistoryPost; r1: HistoryPost };
  epochKeys: Record<number, Uint8Array>;
  communityId: Uint8Array;
  communityIdB64: string;
  sponsor: string;
  device: string;
  newOwner: string;
  idempotencyKeys: { p1: Uint8Array };
  heights: Record<string, number>;
}

function identity(name: string): Identity {
  return identityFromSeed(sha256(`osp-indexer-test-seed-${name}`), 1);
}

function recipient(id: Identity) {
  return { address: id.account, publicKey: id.encryption.publicKey, keyVersion: 1 };
}

/** Builds the scripted history on a fresh ChainBuilder (start height from the deployment). */
export function buildHistory(deployment: Deployment = testDeployment()): History {
  const builder = new ChainBuilder(deployment);
  const chainId = deployment.chainId;
  const alice = identity("alice");
  const bob = identity("bob");
  const carol = identity("carol");
  const dave = identity("dave");
  const eve = identity("eve");
  const sponsor = Signer.fromSeed("osp-indexer-test-sponsor").getAddress();
  const device = Signer.fromSeed("osp-indexer-test-device").getAddress();
  const newOwner = Signer.fromSeed("osp-indexer-test-new-owner").getAddress();
  const rng = deterministicRng("osp-indexer-history");
  const heights: Record<string, number> = {};
  const ev = (name: Parameters<typeof ospEvent>[1], data: Record<string, unknown>, impacted: string[]): EventInput =>
    ospEvent(deployment, name, data, impacted);
  const ts = () => builder.timestampAt(builder.height + 1);

  const registered = (id: Identity, name: string, when: string) =>
    ev(
      "osp.identity.registered",
      {
        account: id.account,
        encryption_key: id.encryption.publicKey,
        key_version: 1,
        profile_hash: sha256(`profile-${name}`),
        profile_uri: `ipfs://profile-${name}`,
        protocol_version: 1,
        timestamp: when,
      },
      [id.account],
    );

  const makePost = (author: Identity, sequence: number, text: string, options: { epochKey?: Uint8Array; epoch?: number; audience?: number } = {}): HistoryPost => {
    const audience = options.audience ?? (options.epochKey ? AUDIENCE.FRIENDS : AUDIENCE.EVERYONE);
    const aad = { chainId, author: author.account, audience, epoch: options.epoch ?? 0, versionNumber: 1 };
    const encrypted = encryptContent({ content: { version: 1, text }, aad, ...(options.epochKey && { epochKey: options.epochKey }), rng });
    const id = postId({ chainId, author: author.account, sequence, contentHash: encrypted.contentHash });
    return { id, idB64: toBase64url(id), envelope: encrypted.bytes, hash: encrypted.contentHash, hashB64: toBase64url(encrypted.contentHash), sequence: String(sequence) };
  };

  const published = (author: Identity, post: HistoryPost, when: string, extra: Record<string, unknown> = {}, impacted: string[] = [author.account]) =>
    ev(
      "osp.publications.published",
      {
        author: author.account,
        post_id: post.id,
        content_hash: post.hash,
        previous_version: new Uint8Array(0),
        version_number: 1,
        sequence: post.sequence,
        audience: AUDIENCE.EVERYONE,
        audience_id: new Uint8Array(0),
        epoch: 0,
        envelope: post.envelope,
        media: [],
        reply_to: new Uint8Array(0),
        idempotency_key: idempotencyKey(author.account, rng(16)),
        protocol_version: 1,
        timestamp: when,
        ...extra,
      },
      impacted,
    );

  // --- block 100: registrations (+ a foreign event and a reverted registration) -----------
  {
    const when = ts();
    heights.register = builder.height + 1;
    builder.block([
      tx([registered(alice, "alice", when)]),
      tx([registered(bob, "bob", when)]),
      tx([registered(carol, "carol", when)]),
      tx([registered(dave, "dave", when)]),
      tx([foreignEvent()]),
      tx([registered(eve, "eve", when)], { reverted: true }),
    ]);
  }

  // --- block 101: friend request alice -> bob, carol follows alice, dave -> alice request ---
  {
    const when = ts();
    heights.friendRequest = builder.height + 1;
    builder.block([
      tx([ev("osp.relationships.friend_requested", { requester: alice.account, recipient: bob.account, nonce: "1", timestamp: when }, [alice.account, bob.account])]),
      tx([ev("osp.relationships.followed", { follower: carol.account, target: alice.account, timestamp: when }, [carol.account, alice.account])]),
      tx([ev("osp.relationships.friend_requested", { requester: dave.account, recipient: alice.account, nonce: "1", timestamp: when }, [dave.account, alice.account])]),
    ]);
  }

  // --- block 102: bob accepts ---------------------------------------------------------------
  {
    const when = ts();
    heights.friendAccepted = builder.height + 1;
    builder.blockWith(
      ev(
        "osp.relationships.friend_accepted",
        { approver: bob.account, requester: alice.account, nonce: "2", key_package_ref: new Uint8Array(0), timestamp: when },
        [bob.account, alice.account],
      ),
    );
  }

  // --- block 103: alice distributes the epoch-0 key to herself and bob ----------------------
  const epochKeys: Record<number, Uint8Array> = { 0: rng(32), 2: rng(32) };
  {
    const when = ts();
    heights.keys0 = builder.height + 1;
    const { bytes } = buildKeyPackageSet({ author: alice.account, epoch: 0, epochKey: epochKeys[0]!, recipients: [recipient(alice), recipient(bob)], rng });
    builder.blockWith(
      ev("osp.publications.keys_distributed", { author: alice.account, audience_id: new Uint8Array(0), epoch: 0, packages: bytes, timestamp: when }, [alice.account]),
    );
  }

  // --- block 104: alice posts publicly (p1) and to friends (p2) -----------------------------
  const p1 = makePost(alice, 1, "hello world");
  const p2 = makePost(alice, 2, "friends only", { epochKey: epochKeys[0]!, epoch: 0 });
  const idemP1 = idempotencyKey(alice.account, rng(16));
  {
    const when = ts();
    heights.posts = builder.height + 1;
    builder.block([
      tx([
        published(alice, p1, when, {
          idempotency_key: idemP1,
          media: [{ content_hash: sha256("img"), mime: "image/png", size: "1234", locations: ["ipfs://img1", "https://cdn.example/img1"], key_ref: new Uint8Array(0) }],
        }),
      ]),
      tx([published(alice, p2, when, { audience: AUDIENCE.FRIENDS, epoch: 0 })]),
    ]);
  }

  // --- block 105: bob reacts to p1 and replies (r1); carol posts p3 -------------------------
  const r1 = makePost(bob, 1, "nice post");
  const p3 = makePost(carol, 1, "carol here");
  {
    const when = ts();
    heights.reactions = builder.height + 1;
    builder.block([
      tx([
        ev(
          "osp.publications.reaction",
          { actor: bob.account, post_id: p1.id, post_author: alice.account, reaction: REACTION.LIKE, removed: false, timestamp: when },
          [bob.account, alice.account],
        ),
      ]),
      tx([published(bob, r1, when, { reply_to: p1.id }, [bob.account, alice.account])]),
      tx([published(carol, p3, when)]),
    ]);
  }

  // --- block 106: alice edits p1; alice posts and deletes p4; carol hides p3 ---------------
  const p1v2 = ((): HistoryPost => {
    const aad = { chainId, author: alice.account, postId: p1.id, audience: AUDIENCE.EVERYONE, epoch: 0, versionNumber: 2 };
    const encrypted = encryptContent({ content: { version: 1, text: "hello world (edited)" }, aad, rng });
    return { ...p1, envelope: encrypted.bytes, hash: encrypted.contentHash, hashB64: toBase64url(encrypted.contentHash) };
  })();
  const p4 = makePost(alice, 3, "deleted soon");
  {
    const when = ts();
    heights.edits = builder.height + 1;
    builder.block([
      tx([
        published(alice, p1v2, when, {
          previous_version: p1.hash,
          version_number: 2,
          media: [{ content_hash: sha256("img"), mime: "image/png", size: "1234", locations: ["ipfs://img1", "https://cdn.example/img1"], key_ref: new Uint8Array(0) }],
        }),
      ]),
      tx([
        published(alice, p4, when),
        ev(
          "osp.publications.lifecycle",
          { author: alice.account, post_id: p4.id, version: p4.hash, state: LIFECYCLE.DELETED, reason: "oops", replacement_id: new Uint8Array(0), timestamp: when },
          [alice.account],
        ),
      ]),
      tx([
        ev(
          "osp.publications.lifecycle",
          { author: carol.account, post_id: p3.id, version: p3.hash, state: LIFECYCLE.AUTHOR_HIDDEN, reason: "", replacement_id: new Uint8Array(0), timestamp: when },
          [carol.account],
        ),
      ]),
    ]);
  }

  // --- block 107: community, role for bob, label on p1 ----------------------------------------
  const communityId = sha256("community-1");
  {
    const when = ts();
    heights.community = builder.height + 1;
    builder.block([
      tx([
        ev(
          "osp.communities.community_created",
          { id: communityId, owner: alice.account, name: "Test Community", policy_hash: sha256("policy"), policy_uri: "ipfs://policy", transfer_delay_ms: "86400000", timestamp: when },
          [alice.account],
        ),
      ]),
      tx([
        ev(
          "osp.communities.role_set",
          { community_id: communityId, actor: alice.account, subject: bob.account, role: COMMUNITY_ROLE.MODERATOR, scope: new Uint8Array(0), expires_at: "0", timestamp: when },
          [alice.account, bob.account],
        ),
      ]),
      tx([
        ev(
          "osp.communities.label_set",
          { community_id: communityId, actor: bob.account, post_id: p1.id, label: "warn:test", reason: "testing", timestamp: when },
          [bob.account, alice.account],
        ),
      ]),
    ]);
  }

  // --- block 108: sponsor, grant, registry -----------------------------------------------------
  {
    const when = ts();
    heights.sponsor = builder.height + 1;
    builder.block([
      tx([ev("osp.sponsorship.sponsor_set", { sponsor, endpoint: "https://sponsor.example.org", policy_version: 1, active: true, timestamp: when }, [sponsor])]),
      tx([ev("osp.sponsorship.user_grant_set", { sponsor, user: alice.account, daily_ops: 100, expires_at: "1770000000000", timestamp: when }, [sponsor, alice.account])]),
      tx([
        ev("osp.registry.contract_proposed", { name: "identity", address: deployment.contracts.identity.address, version: 1, abi_hash: sha256("abi"), effective_at: when }, []),
        ev("osp.registry.contract_activated", { name: "identity", address: deployment.contracts.identity.address, version: 1, timestamp: when }, []),
      ]),
    ]);
  }

  // --- block 109: device, recovery policy, recovery proposal ---------------------------------
  {
    const when = ts();
    heights.device = builder.height + 1;
    builder.block([
      tx([
        ev(
          "osp.identity.device_authorized",
          { account: alice.account, device, capabilities: 7, expires_at: "1790000000000", label: "laptop", device_epoch: 0, timestamp: when },
          [alice.account, device],
        ),
      ]),
      tx([
        ev(
          "osp.identity.recovery_policy_set",
          { account: alice.account, policy: { guardians: [carol.account, bob.account], threshold: 1, delay_ms: "3600000" }, timestamp: when },
          [alice.account, carol.account, bob.account],
        ),
      ]),
      tx([
        ev(
          "osp.identity.recovery_proposed",
          { account: alice.account, guardian: carol.account, new_owner: newOwner, approvals: 1, threshold: 1, effective_at: "1770003600000", timestamp: when },
          [alice.account, carol.account, newOwner],
        ),
      ]),
    ]);
  }

  // --- block 110: alice blocks dave (epoch 1); carol reacts then un-reacts; carol -> bob request
  {
    const when = ts();
    heights.block = builder.height + 1;
    builder.block([
      tx([
        ev("osp.relationships.blocked", { actor: alice.account, target: dave.account, new_epoch: 1, timestamp: when }, [alice.account, dave.account]),
        ev("osp.relationships.audience_rotated", { account: alice.account, new_epoch: 1, reason: "blocked", timestamp: when }, [alice.account]),
      ]),
      tx([
        ev(
          "osp.publications.reaction",
          { actor: carol.account, post_id: p1.id, post_author: alice.account, reaction: REACTION.LIKE, removed: false, timestamp: when },
          [carol.account, alice.account],
        ),
      ]),
      tx([
        ev(
          "osp.publications.reaction",
          { actor: carol.account, post_id: p1.id, post_author: alice.account, reaction: REACTION.LIKE, removed: true, timestamp: when },
          [carol.account, alice.account],
        ),
      ]),
      tx([ev("osp.relationships.friend_requested", { requester: carol.account, recipient: bob.account, nonce: "1", timestamp: when }, [carol.account, bob.account])]),
    ]);
  }

  // --- block 111: empty ---------------------------------------------------------------------------
  heights.empty = builder.height + 1;
  builder.block([]);

  // --- block 112: manual rotation to epoch 2 + keys, cross-post outcome for p1 -----------------
  {
    const when = ts();
    heights.rotate = builder.height + 1;
    const { bytes } = buildKeyPackageSet({ author: alice.account, epoch: 2, epochKey: epochKeys[2]!, recipients: [recipient(alice), recipient(bob)], rng });
    builder.block([
      tx([ev("osp.relationships.audience_rotated", { account: alice.account, new_epoch: 2, reason: "manual", timestamp: when }, [alice.account])]),
      tx([ev("osp.publications.keys_distributed", { author: alice.account, audience_id: new Uint8Array(0), epoch: 2, packages: bytes, timestamp: when }, [alice.account])]),
      tx([
        ev(
          "osp.publications.cross_post_outcome",
          { author: alice.account, idempotency_key: idemP1, adapter: "facebook", state: 0, external_ref: "https://facebook.example/1", post_id: p1.id, manifest_hash: sha256("manifest"), timestamp: when },
          [alice.account],
        ),
      ]),
    ]);
  }
  heights.head = builder.height;

  return {
    deployment,
    builder,
    chainId,
    actors: { alice, bob, carol, dave },
    posts: { p1, p1v2, p2, p3, p4, r1 },
    epochKeys,
    communityId,
    communityIdB64: toBase64url(communityId),
    sponsor,
    device,
    newOwner,
    idempotencyKeys: { p1: idemP1 },
    heights,
  };
}

/** Content hash helper re-export for tests. */
export { contentHash };
