import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUDIENCE, decode, decryptContent, fromBase64url, openEpochKey, toBase64url, type SealedKey } from "@osp/sdk";
import { IndexerDb, KoinosChain, createIndexer, loadConfig, type Indexer } from "./index.js";
import { FakeProvider } from "./testing/fake-chain.js";
import { buildHistory, sha256, type History } from "./testing/history.js";

let history: History;
let indexer: Indexer;
let provider: FakeProvider;

async function get(url: string): Promise<{ status: number; body: any; headers: Record<string, unknown> }> {
  const res = await indexer.api.inject({ method: "GET", url });
  return { status: res.statusCode, body: res.json(), headers: res.headers as Record<string, unknown> };
}

beforeAll(async () => {
  history = buildHistory();
  provider = new FakeProvider(history.builder);
  const config = loadConfig({ OSP_NETWORK: "test", OSP_INDEXER_DB: ":memory:", OSP_BATCH_SIZE: "4" }, { deployment: history.deployment });
  indexer = createIndexer({ config, db: IndexerDb.memory(), chain: new KoinosChain(provider, history.deployment) });
  const result = await indexer.syncer!.syncToHead();
  expect(result.applied).toBe(history.heights.head! - 100 + 1);
  expect(result.caughtUp).toBe(true);
});

afterAll(async () => {
  await indexer.close();
});

describe("sync", () => {
  it("indexes every block up to the head and never above it", async () => {
    const tip = indexer.db.lastCheckpoint()!;
    expect(tip.height).toBe(history.heights.head);
    expect(tip.block_id).toBe(history.builder.headId);
    expect(indexer.db.firstCheckpoint()!.height).toBe(100);
    // A second pass is a no-op.
    const again = await indexer.syncer!.syncOnce();
    expect(again).toEqual({ applied: 0, caughtUp: true });
  });

  it("keeps only protocol events from non-reverted transactions in the log", () => {
    const count = indexer.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM event_log")!.c;
    expect(count).toBe(36);
    const names = indexer.db.all<{ name: string }>("SELECT DISTINCT name FROM event_log").map((r) => r.name);
    expect(names.every((n) => n.startsWith("osp."))).toBe(true);
    // eve's registration was in a reverted transaction
    expect(indexer.db.get("SELECT 1 AS one FROM identities WHERE account = ?", history.actors.alice.account)).toBeDefined();
    expect(indexer.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM identities")!.c).toBe(4);
  });
});

describe("GET /v1/status", () => {
  it("reports the deployment, head and indexed tip", async () => {
    const { status, body, headers } = await get("/v1/status");
    expect(status).toBe(200);
    expect(headers["access-control-allow-origin"]).toBe("*");
    expect(body.network).toBe("test");
    expect(body.chainId).toBe(history.deployment.chainId);
    expect(body.contracts.identity).toBe(history.deployment.contracts.identity.address);
    expect(body.head).toEqual({ height: String(history.heights.head), id: history.builder.headId });
    expect(body.indexed.height).toBe(String(history.heights.head));
    expect(body.indexed.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.lastIrreversible).toBe(String(provider.lib));
    expect(body.startHeight).toBe("100");
    expect(body.healthy).toBe(true);
    expect(body.deployed).toBe(true);
    expect(typeof body.version).toBe("string");
  });
});

describe("GET /v1/profiles", () => {
  it("returns a registered profile with counts, devices and recovery state", async () => {
    const alice = history.actors.alice;
    const { status, body } = await get(`/v1/profiles/${alice.account}`);
    expect(status).toBe(200);
    expect(body.account).toBe(alice.account);
    expect(body.owner).toBe(alice.account);
    expect(body.encryptionKey).toBe(toBase64url(alice.encryption.publicKey));
    expect(body.keyVersion).toBe(1);
    expect(body.profileUri).toBe("ipfs://profile-alice");
    expect(body.protocolVersion).toBe(1);
    expect(body.deviceEpoch).toBe(0);
    expect(body.registeredAt).toBe(history.builder.timestampAt(100));
    expect(body.counts).toEqual({ posts: 2, friends: 1, followers: 1, following: 0 });
    expect(body.devices).toHaveLength(1);
    expect(body.devices[0]).toMatchObject({ device: history.device, capabilities: 7, label: "laptop", revoked: false });
    expect(body.recovery.policy).toEqual({ guardians: [history.actors.carol.account, history.actors.bob.account], threshold: 1, delayMs: "3600000" });
    expect(body.recovery.pendingRecovery.newOwner).toBe(history.newOwner);
  });

  it("404s for unknown accounts and 400s for invalid ones", async () => {
    const unknown = await get(`/v1/profiles/${history.newOwner}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: { code: "not_found", message: "identity not registered" } });
    const invalid = await get("/v1/profiles/not-an-address");
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("invalid_address");
  });

  it("searches by address prefix", async () => {
    const alice = history.actors.alice.account;
    const { status, body } = await get(`/v1/profiles?query=${alice.slice(0, 6)}&limit=10`);
    expect(status).toBe(200);
    expect(body.items.map((i: { account: string }) => i.account)).toContain(alice);
    const exact = await get(`/v1/profiles?query=${alice}`);
    expect(exact.body.items).toHaveLength(1);
    const bad = await get("/v1/profiles?query=0OIl");
    expect(bad.status).toBe(400);
  });
});

describe("GET /v1/graph/:account", () => {
  it("lists friends, pending requests, follows, blocks and the audience epoch", async () => {
    const { alice, bob, carol, dave } = history.actors;
    const a = (await get(`/v1/graph/${alice.account}`)).body;
    expect(a.friends).toEqual([{ account: bob.account, since: history.builder.timestampAt(102), nonce: "2" }]);
    expect(a.pendingIncoming).toEqual([]); // dave's request ended when alice blocked him
    expect(a.pendingOutgoing).toEqual([]);
    expect(a.followers).toEqual([carol.account]);
    expect(a.following).toEqual([]);
    expect(a.blocked).toEqual([dave.account]);
    expect(a.audienceEpoch).toBe(2);

    const b = (await get(`/v1/graph/${bob.account}`)).body;
    expect(b.friends.map((f: { account: string }) => f.account)).toEqual([alice.account]);
    expect(b.pendingIncoming).toEqual([{ account: carol.account, requestedAt: history.builder.timestampAt(110), nonce: "1" }]);

    const c = (await get(`/v1/graph/${carol.account}`)).body;
    expect(c.pendingOutgoing).toEqual([{ account: bob.account, requestedAt: history.builder.timestampAt(110), nonce: "1" }]);
    expect(c.following).toEqual([alice.account]);

    const d = (await get(`/v1/graph/${dave.account}`)).body;
    expect(d.blockedBy).toEqual([alice.account]);
    expect(d.friends).toEqual([]);
  });
});

describe("GET /v1/feed", () => {
  it("public scope lists everyone-audience top-level posts, excluding hidden and deleted ones", async () => {
    const { status, body } = await get("/v1/feed");
    expect(status).toBe(200);
    expect(body.items.map((p: { postId: string }) => p.postId)).toEqual([history.posts.p1.idB64]);
    expect(body.nextCursor).toBeNull();
  });

  it("friends scope needs a viewer and includes friends-only posts by active friends", async () => {
    const { bob, carol } = history.actors;
    const noViewer = await get("/v1/feed?scope=friends");
    expect(noViewer.status).toBe(400);
    const forBob = (await get(`/v1/feed?scope=friends&viewer=${bob.account}`)).body;
    expect(forBob.items.map((p: { postId: string }) => p.postId)).toEqual([history.posts.p2.idB64, history.posts.p1.idB64]);
    expect(forBob.items[0].audience).toBe(AUDIENCE.FRIENDS);
    expect(forBob.items[0].reactions.viewer).toEqual([]);
    expect(forBob.items[1].reactions.viewer).toEqual([1]);
    const forCarol = (await get(`/v1/feed?scope=friends&viewer=${carol.account}`)).body;
    expect(forCarol.items).toEqual([]);
  });

  it("all scope is the union and paginates with opaque cursors", async () => {
    const { bob } = history.actors;
    const first = (await get(`/v1/feed?scope=all&viewer=${bob.account}&limit=1`)).body;
    expect(first.items.map((p: { postId: string }) => p.postId)).toEqual([history.posts.p2.idB64]);
    expect(typeof first.nextCursor).toBe("string");
    const second = (await get(`/v1/feed?scope=all&viewer=${bob.account}&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`)).body;
    expect(second.items.map((p: { postId: string }) => p.postId)).toEqual([history.posts.p1.idB64]);
    expect(second.nextCursor).toBeNull();
    const bad = await get("/v1/feed?cursor=%%%");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_cursor");
    const badScope = await get("/v1/feed?scope=nope");
    expect(badScope.status).toBe(400);
  });
});

describe("GET /v1/posts", () => {
  it("returns the latest version with history, reactions, replies and labels", async () => {
    const { p1, p1v2 } = history.posts;
    const { status, body } = await get(`/v1/posts/${p1.idB64}?viewer=${history.actors.bob.account}`);
    expect(status).toBe(200);
    expect(body.author).toBe(history.actors.alice.account);
    expect(body.sequence).toBe("1");
    expect(body.versionNumber).toBe(2);
    expect(body.contentHash).toBe(p1v2.hashB64);
    expect(body.previousVersion).toBe(p1.hashB64);
    expect(body.envelope).toBe(toBase64url(p1v2.envelope));
    expect(body.versions.map((v: { versionNumber: number; contentHash: string }) => [v.versionNumber, v.contentHash])).toEqual([
      [1, p1.hashB64],
      [2, p1v2.hashB64],
    ]);
    expect(body.versions[0].blockHeight).toBe("104");
    expect(body.versions[1].blockHeight).toBe("106");
    expect(body.blockHeight).toBe("104");
    expect(body.createdAt).toBe(history.builder.timestampAt(104));
    expect(body.updatedAt).toBe(history.builder.timestampAt(106));
    expect(body.media).toEqual([{ contentHash: toBase64url(sha256("img")), mime: "image/png", size: "1234", locations: ["ipfs://img1", "https://cdn.example/img1"], keyRef: "" }]);
    expect(body.reactions).toEqual({ total: 1, byType: { "1": 1 }, viewer: [1] });
    expect(body.replyCount).toBe(1);
    expect(body.labels).toHaveLength(1);
    expect(body.labels[0]).toMatchObject({ communityId: history.communityIdB64, label: "warn:test", reason: "testing", actor: history.actors.bob.account });
    expect(body.state).toBe(0);
    expect(body.replyTo).toBe("");
  });

  it("keeps deleted and hidden posts fetchable by id with their state", async () => {
    const deleted = (await get(`/v1/posts/${history.posts.p4.idB64}`)).body;
    expect(deleted.state).toBe(2);
    expect(deleted.stateReason).toBe("oops");
    const hidden = (await get(`/v1/posts/${history.posts.p3.idB64}`)).body;
    expect(hidden.state).toBe(1);
    const missing = await get(`/v1/posts/${toBase64url(new Uint8Array(32).fill(9))}`);
    expect(missing.status).toBe(404);
  });

  it("serves the encrypted envelope and the sealed keys needed to read it", async () => {
    const { alice, bob } = history.actors;
    const post = (await get(`/v1/posts/${history.posts.p2.idB64}`)).body;
    expect(post.audience).toBe(AUDIENCE.FRIENDS);
    expect(post.epoch).toBe(0);
    const keys = (await get(`/v1/keys/${bob.account}?author=${alice.account}&epoch=0`)).body;
    expect(keys.items).toHaveLength(1);
    const sealed = decode<SealedKey>("osp.envelope.sealed_key", fromBase64url(keys.items[0].sealedKey));
    const epochKey = openEpochKey({ sealed, recipientSecretKey: bob.encryption.secretKey, author: alice.account, epoch: 0 });
    expect(epochKey).toEqual(history.epochKeys[0]);
    const content = decryptContent({
      envelope: fromBase64url(post.envelope),
      aad: { chainId: history.chainId, author: alice.account, audience: AUDIENCE.FRIENDS, epoch: 0, versionNumber: 1 },
      epochKey,
    });
    expect(content.text).toBe("friends only");
    // every distribution addressed to bob, newest epoch last
    const all = (await get(`/v1/keys/${bob.account}`)).body;
    expect(all.items.map((k: { epoch: number }) => k.epoch)).toEqual([0, 2]);
    expect((await get(`/v1/keys/${history.actors.carol.account}`)).body.items).toEqual([]);
  });

  it("lists replies and account posts", async () => {
    const replies = (await get(`/v1/posts/${history.posts.p1.idB64}/replies`)).body;
    expect(replies.items.map((p: { postId: string; replyTo: string }) => [p.postId, p.replyTo])).toEqual([[history.posts.r1.idB64, history.posts.p1.idB64]]);
    const missing = await get(`/v1/posts/${toBase64url(new Uint8Array(32).fill(8))}/replies`);
    expect(missing.status).toBe(404);
    const posts = (await get(`/v1/accounts/${history.actors.alice.account}/posts`)).body;
    expect(posts.items.map((p: { postId: string }) => p.postId)).toEqual([history.posts.p2.idB64, history.posts.p1.idB64]);
  });
});

describe("GET /v1/notifications/:account", () => {
  it("derives notifications per spec and streams with a cursor", async () => {
    const { alice, bob, carol, dave } = history.actors;
    const { body } = await get(`/v1/notifications/${alice.account}`);
    const kinds = body.items.map((n: { kind: string; actor: string }) => `${n.kind}:${n.actor}`);
    expect(kinds).toEqual([
      `friend_request:${dave.account}`,
      `friend_accepted:${bob.account}`,
      `reaction:${bob.account}`,
      `reply:${bob.account}`,
      `label:${bob.account}`,
      `device:${history.device}`,
      `recovery:${carol.account}`,
      `reaction:${carol.account}`,
    ]);
    expect(body.items[3]).toMatchObject({ postId: history.posts.p1.idB64, data: { replyId: history.posts.r1.idB64 } });
    expect(body.nextCursor).toBe(body.items[body.items.length - 1].id);
    const newer = (await get(`/v1/notifications/${alice.account}?since=${body.nextCursor}`)).body;
    expect(newer.items).toEqual([]);
    expect(newer.nextCursor).toBe(body.nextCursor);
    const paged = (await get(`/v1/notifications/${alice.account}?since=${body.items[1].id}&limit=2`)).body;
    expect(paged.items.map((n: { id: string }) => n.id)).toEqual([body.items[2].id, body.items[3].id]);

    const forBob = (await get(`/v1/notifications/${bob.account}`)).body;
    expect(forBob.items.map((n: { kind: string }) => n.kind)).toEqual(["keys", "role", "friend_request", "keys"]);
    expect(forBob.items[0].data).toEqual({ audienceId: "", epoch: 0 });
    expect(forBob.items[1]).toMatchObject({ communityId: history.communityIdB64, data: { role: 3 } });
  });
});

describe("audiences, communities, labels, sponsors, registry", () => {
  it("GET /v1/audiences/:author reports the epoch history", async () => {
    const { body } = await get(`/v1/audiences/${history.actors.alice.account}`);
    expect(body.epoch).toBe(2);
    expect(body.epochs).toEqual([
      { epoch: 0, since: history.builder.timestampAt(100), reason: "initial" },
      { epoch: 1, since: history.builder.timestampAt(110), reason: "blocked" },
      { epoch: 2, since: history.builder.timestampAt(112), reason: "manual" },
    ]);
    const bob = (await get(`/v1/audiences/${history.actors.bob.account}`)).body;
    expect(bob).toMatchObject({ epoch: 0 });
  });

  it("GET /v1/communities/:id returns the record with roles", async () => {
    const { status, body } = await get(`/v1/communities/${history.communityIdB64}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: history.communityIdB64, owner: history.actors.alice.account, name: "Test Community", policyUri: "ipfs://policy", transferDelayMs: "86400000" });
    expect(body.roles).toEqual([
      { subject: history.actors.bob.account, role: 3, scope: "", expiresAt: "0", grantedBy: history.actors.alice.account, grantedAt: history.builder.timestampAt(107) },
    ]);
    expect((await get(`/v1/communities/${toBase64url(new Uint8Array(32))}`)).status).toBe(404);
  });

  it("GET /v1/labels filters by post or community", async () => {
    const byPost = (await get(`/v1/labels?postId=${history.posts.p1.idB64}`)).body;
    expect(byPost.items).toHaveLength(1);
    expect(byPost.items[0]).toMatchObject({ label: "warn:test", blockHeight: "107" });
    const byCommunity = (await get(`/v1/labels?communityId=${history.communityIdB64}`)).body;
    expect(byCommunity.items).toHaveLength(1);
    expect((await get("/v1/labels")).status).toBe(400);
  });

  it("GET /v1/sponsors and /v1/registry list chain records", async () => {
    const sponsors = (await get("/v1/sponsors")).body;
    expect(sponsors.items).toEqual([
      { sponsor: history.sponsor, endpoint: "https://sponsor.example.org", policyVersion: 1, active: true, registeredAt: history.builder.timestampAt(108), updatedAt: history.builder.timestampAt(108) },
    ]);
    const registry = (await get("/v1/registry")).body;
    expect(registry.items).toEqual([
      { name: "identity", address: history.deployment.contracts.identity.address, version: 1, abiHash: expect.any(String), status: 1, effectiveAt: history.builder.timestampAt(108), updatedAt: history.builder.timestampAt(108) },
    ]);
  });
});

describe("GET /v1/events and /v1/conformance/state-hash", () => {
  it("pages the decoded log by whole blocks", async () => {
    const first = (await get("/v1/events?fromHeight=100&limit=5")).body;
    expect(first.items).toHaveLength(4);
    expect(first.items.every((e: { height: string }) => e.height === "100")).toBe(true);
    expect(first.items[0]).toMatchObject({ contract: "identity", name: "osp.identity.registered", txIndex: 0, sequence: 0, impacted: [history.actors.alice.account] });
    expect(first.items[0].data.account).toBe(history.actors.alice.account);
    expect(first.items[0].data.encryption_key).toBe(toBase64url(history.actors.alice.encryption.publicKey));
    expect(first.nextHeight).toBe("101");
    const rest = (await get(`/v1/events?fromHeight=${first.nextHeight}&limit=1000`)).body;
    expect(rest.items).toHaveLength(32);
    expect(rest.nextHeight).toBeNull();
    const beyond = (await get("/v1/events?fromHeight=500")).body;
    expect(beyond).toEqual({ items: [], nextHeight: null });
    expect((await get("/v1/events?fromHeight=-1")).status).toBe(400);
  });

  it("exposes checkpoints for cross-indexer comparison", async () => {
    const latest = (await get("/v1/conformance/state-hash")).body;
    expect(latest).toEqual({ height: String(history.heights.head), blockId: history.builder.headId, stateHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const at = (await get("/v1/conformance/state-hash?height=105")).body;
    expect(at.height).toBe("105");
    expect(at.blockId).toBe(history.builder.blocks[5]!.block_id);
    expect(at.stateHash).not.toBe(latest.stateHash);
    expect((await get("/v1/conformance/state-hash?height=999")).status).toBe(404);
  });

  it("answers unknown routes with the JSON error shape", async () => {
    const { status, body } = await get("/v1/nope");
    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: "not_found", message: "route not found" } });
  });
});
