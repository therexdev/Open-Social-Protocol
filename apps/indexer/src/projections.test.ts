/**
 * Projection handlers that the main scripted history (testing/history.ts) does not reach:
 * profile_updated, key_rotated, device_revoked, recovery_policy_proposed/cancelled,
 * recovery_cancelled, recovered, friend_removed, unfollowed, unblocked, policy_set,
 * owner_transfer_proposed/cancelled, owner_transferred, role_set(none), sponsor_deactivated,
 * user_grant_revoked, contract_deprecated/cancelled and admin_proposed/changed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMMUNITY_ROLE, Signer, identityFromSeed, toBase64url } from "@osp/sdk";
import { IndexerDb, KoinosChain, createIndexer, loadConfig, replayProjections, type Indexer } from "./index.js";
import { ChainBuilder, FakeProvider, ospEvent, testDeployment, tx, type EventInput } from "./testing/fake-chain.js";
import { sha256 } from "./testing/history.js";

const deployment = testDeployment();
const builder = new ChainBuilder(deployment);
const alice = identityFromSeed(sha256("projections-alice"), 1);
const bob = identityFromSeed(sha256("projections-bob"), 1);
const carol = identityFromSeed(sha256("projections-carol"), 1);
const newOwner = Signer.fromSeed("projections-new-owner").getAddress();
const device = Signer.fromSeed("projections-device").getAddress();
const sponsor = Signer.fromSeed("projections-sponsor").getAddress();
const admin = Signer.fromSeed("projections-admin").getAddress();
const newAdmin = Signer.fromSeed("projections-new-admin").getAddress();
const publicationsV2 = Signer.fromSeed("projections-publications-v2").getAddress();
const communitiesV2 = Signer.fromSeed("projections-communities-v2").getAddress();
const communityId = sha256("projections-community");
const communityIdB64 = toBase64url(communityId);
const newKey = new Uint8Array(32).fill(0xab);

const ev = (name: Parameters<typeof ospEvent>[1], data: Record<string, unknown>, impacted: string[] = []): EventInput => ospEvent(deployment, name, data, impacted);

// --- block 100: the state the later events act upon ------------------------------------------
const t100 = builder.timestampAt(100);
builder.block([
  tx([
    ev("osp.identity.registered", { account: alice.account, encryption_key: alice.encryption.publicKey, key_version: 1, profile_hash: sha256("p-alice"), profile_uri: "ipfs://alice", protocol_version: 1, timestamp: t100 }),
    ev("osp.identity.registered", { account: bob.account, encryption_key: bob.encryption.publicKey, key_version: 1, profile_hash: sha256("p-bob"), profile_uri: "ipfs://bob", protocol_version: 1, timestamp: t100 }),
    ev("osp.identity.registered", { account: carol.account, encryption_key: carol.encryption.publicKey, key_version: 1, profile_hash: sha256("p-carol"), profile_uri: "ipfs://carol", protocol_version: 1, timestamp: t100 }),
  ]),
  tx([
    ev("osp.relationships.friend_requested", { requester: alice.account, recipient: bob.account, nonce: "1", timestamp: t100 }),
    ev("osp.relationships.friend_accepted", { approver: bob.account, requester: alice.account, nonce: "2", key_package_ref: new Uint8Array(0), timestamp: t100 }),
    ev("osp.relationships.followed", { follower: carol.account, target: alice.account, timestamp: t100 }),
    ev("osp.relationships.followed", { follower: bob.account, target: alice.account, timestamp: t100 }),
    ev("osp.relationships.blocked", { actor: bob.account, target: carol.account, new_epoch: 1, timestamp: t100 }),
  ]),
  tx([
    ev("osp.identity.device_authorized", { account: alice.account, device, capabilities: 3, expires_at: "0", label: "phone", device_epoch: 0, timestamp: t100 }),
    ev("osp.communities.community_created", { id: communityId, owner: alice.account, name: "Projections", policy_hash: sha256("policy-1"), policy_uri: "ipfs://policy-1", transfer_delay_ms: "1000", timestamp: t100 }),
    ev("osp.communities.role_set", { community_id: communityId, actor: alice.account, subject: bob.account, role: COMMUNITY_ROLE.MODERATOR, scope: new Uint8Array(0), expires_at: "0", timestamp: t100 }),
  ]),
  tx([
    ev("osp.sponsorship.sponsor_set", { sponsor, endpoint: "https://sponsor.example", policy_version: 1, active: true, timestamp: t100 }),
    ev("osp.sponsorship.user_grant_set", { sponsor, user: alice.account, daily_ops: 10, expires_at: "0", timestamp: t100 }),
    ev("osp.registry.contract_proposed", { name: "identity", address: deployment.contracts.identity.address, version: 1, abi_hash: sha256("abi-identity"), effective_at: t100 }),
    ev("osp.registry.contract_activated", { name: "identity", address: deployment.contracts.identity.address, version: 1, timestamp: t100 }),
    ev("osp.registry.contract_proposed", { name: "publications", address: publicationsV2, version: 2, abi_hash: sha256("abi-publications-2"), effective_at: "1800000000000" }),
    ev("osp.registry.contract_proposed", { name: "communities", address: communitiesV2, version: 2, abi_hash: sha256("abi-communities-2"), effective_at: "1800000000000" }),
    ev("osp.registry.admin_proposed", { new_admin: newAdmin, effective_at: "1800000000000" }),
  ]),
]);

// --- block 101: every handler not covered by the main history ---------------------------------
const t101 = builder.timestampAt(101);
const policy = { guardians: [carol.account], threshold: 1, delay_ms: "60000" };
builder.block([
  tx([
    ev("osp.identity.profile_updated", { account: alice.account, profile_hash: sha256("p-alice-2"), profile_uri: "ipfs://alice-2", timestamp: t101 }),
    ev("osp.identity.key_rotated", { account: alice.account, previous_version: 1, encryption_key: newKey, key_version: 2, timestamp: t101 }),
    ev("osp.identity.device_revoked", { account: alice.account, device, timestamp: t101 }),
    ev("osp.identity.recovery_policy_proposed", { account: alice.account, policy, effective_at: "1800000000000" }),
    ev("osp.identity.recovery_policy_cancelled", { account: alice.account, timestamp: t101 }),
    ev("osp.identity.recovery_policy_proposed", { account: alice.account, policy, effective_at: "1800000000001" }),
    ev("osp.identity.recovery_policy_set", { account: alice.account, policy, timestamp: t101 }),
    ev("osp.identity.recovery_proposed", { account: alice.account, guardian: carol.account, new_owner: newOwner, approvals: 1, threshold: 1, effective_at: "1800000000000", timestamp: t101 }),
    ev("osp.identity.recovery_cancelled", { account: alice.account, timestamp: t101 }),
    ev("osp.identity.recovery_proposed", { account: alice.account, guardian: carol.account, new_owner: newOwner, approvals: 1, threshold: 1, effective_at: "1800000000000", timestamp: t101 }),
    ev("osp.identity.recovered", { account: alice.account, previous_owner: alice.account, new_owner: newOwner, device_epoch: 1, timestamp: t101 }),
  ]),
  tx([
    ev("osp.relationships.friend_removed", { actor: alice.account, peer: bob.account, nonce: "3", new_epoch: 1, timestamp: t101 }),
    ev("osp.relationships.audience_rotated", { account: alice.account, new_epoch: 1, reason: "friend_removed", timestamp: t101 }),
    ev("osp.relationships.unfollowed", { follower: carol.account, target: alice.account, timestamp: t101 }),
    ev("osp.relationships.unblocked", { actor: bob.account, target: carol.account, timestamp: t101 }),
  ]),
  tx([
    ev("osp.communities.policy_set", { community_id: communityId, actor: alice.account, policy_hash: sha256("policy-2"), policy_uri: "ipfs://policy-2", timestamp: t101 }),
    ev("osp.communities.owner_transfer_proposed", { community_id: communityId, owner: alice.account, new_owner: carol.account, effective_at: "1800000000000" }),
    ev("osp.communities.owner_transfer_cancelled", { community_id: communityId, timestamp: t101 }),
    ev("osp.communities.owner_transfer_proposed", { community_id: communityId, owner: alice.account, new_owner: bob.account, effective_at: "1800000000000" }),
    ev("osp.communities.owner_transferred", { community_id: communityId, previous_owner: alice.account, new_owner: bob.account, timestamp: t101 }),
    ev("osp.communities.role_set", { community_id: communityId, actor: bob.account, subject: bob.account, role: COMMUNITY_ROLE.NONE, scope: new Uint8Array(0), expires_at: "0", timestamp: t101 }),
  ]),
  tx([
    ev("osp.sponsorship.sponsor_deactivated", { sponsor, timestamp: t101 }),
    ev("osp.sponsorship.user_grant_revoked", { sponsor, user: alice.account, timestamp: t101 }),
    ev("osp.registry.contract_deprecated", { name: "identity", address: deployment.contracts.identity.address, version: 1, timestamp: t101 }),
    ev("osp.registry.contract_activated", { name: "publications", address: publicationsV2, version: 2, timestamp: t101 }),
    ev("osp.registry.contract_cancelled", { name: "communities", timestamp: t101 }),
    ev("osp.registry.admin_changed", { previous_admin: admin, new_admin: newAdmin, timestamp: t101 }),
  ]),
]);

let indexer: Indexer;

async function get(url: string): Promise<{ status: number; body: any }> {
  const res = await indexer.api.inject({ method: "GET", url });
  return { status: res.statusCode, body: res.json() };
}

async function snapshot(): Promise<string> {
  const urls = [
    `/v1/profiles/${alice.account}`,
    `/v1/accounts/${alice.account}/devices`,
    `/v1/graph/${alice.account}`,
    `/v1/graph/${bob.account}`,
    `/v1/audiences/${alice.account}`,
    `/v1/communities/${communityIdB64}`,
    "/v1/sponsors",
    "/v1/registry",
    `/v1/notifications/${alice.account}`,
  ];
  const bodies = [];
  for (const url of urls) bodies.push((await indexer.api.inject({ method: "GET", url })).body);
  return bodies.join("\n");
}

beforeAll(async () => {
  const config = loadConfig({ OSP_NETWORK: "test", OSP_INDEXER_DB: ":memory:" }, { deployment });
  indexer = createIndexer({ config, db: IndexerDb.memory(), chain: new KoinosChain(new FakeProvider(builder), deployment) });
  expect(await indexer.syncer!.syncToHead()).toEqual({ applied: 2, caughtUp: true });
  expect(indexer.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM event_log")!.c).toBe(45);
});

afterAll(async () => {
  await indexer.close();
});

describe("identity projections", () => {
  it("applies profile updates, key rotation, device revocation, recovery policy and recovery", async () => {
    const { status, body } = await get(`/v1/profiles/${alice.account}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      account: alice.account,
      owner: newOwner,
      encryptionKey: toBase64url(newKey),
      keyVersion: 2,
      profileHash: toBase64url(sha256("p-alice-2")),
      profileUri: "ipfs://alice-2",
      deviceEpoch: 1,
      registeredAt: t100,
      updatedAt: t101,
    });
    expect(body.recovery).toEqual({ policy: { guardians: [carol.account], threshold: 1, delayMs: "60000" }, pendingPolicy: null, pendingRecovery: null });
    expect(body.devices).toEqual([{ device, capabilities: 3, expiresAt: "0", deviceEpoch: 0, revoked: true, label: "phone", authorizedAt: t100 }]);
    expect((await get(`/v1/accounts/${alice.account}/devices`)).body.items).toEqual(body.devices);
  });

  it("keeps the pending policy while it is proposed and clears it when cancelled or set", () => {
    const row = indexer.db.get<{ pending_policy_json: string | null; recovery_policy_json: string | null }>("SELECT pending_policy_json, recovery_policy_json FROM identities WHERE account = ?", alice.account)!;
    expect(row.pending_policy_json).toBeNull();
    expect(JSON.parse(row.recovery_policy_json!)).toEqual({ guardians: [carol.account], threshold: 1, delayMs: "60000" });
  });

  it("notifies the account about device and recovery changes (no self-notifications)", async () => {
    const { body } = await get(`/v1/notifications/${alice.account}`);
    const actions = body.items.map((n: { kind: string; actor: string; data: { action?: string } }) => `${n.kind}:${n.data.action ?? n.actor}`);
    expect(actions).toEqual([
      `friend_accepted:${bob.account}`,
      "device:authorized",
      "device:revoked",
      "recovery:proposed",
      "recovery:proposed",
      "recovery:executed",
    ]);
    expect(body.items[5]).toMatchObject({ actor: newOwner, data: { previousOwner: alice.account, newOwner, deviceEpoch: 1 } });
  });
});

describe("relationship projections", () => {
  it("applies friend_removed, unfollowed and unblocked", async () => {
    const a = (await get(`/v1/graph/${alice.account}`)).body;
    expect(a.friends).toEqual([]);
    expect(a.pendingIncoming).toEqual([]);
    expect(a.followers).toEqual([bob.account]); // carol unfollowed
    expect(a.audienceEpoch).toBe(1);
    const edge = indexer.db.get<{ status: number; nonce: string; requester: string; since: string }>(
      "SELECT status, nonce, requester, since FROM relationships WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)",
      alice.account,
      bob.account,
      bob.account,
      alice.account,
    )!;
    expect(edge).toEqual({ status: 3, nonce: "3", requester: alice.account, since: t100 });
    const b = (await get(`/v1/graph/${bob.account}`)).body;
    expect(b.blocked).toEqual([]);
    expect((await get(`/v1/graph/${carol.account}`)).body.blockedBy).toEqual([]);
    expect((await get(`/v1/audiences/${alice.account}`)).body.epochs).toEqual([
      { epoch: 0, since: t100, reason: "initial" },
      { epoch: 1, since: t101, reason: "friend_removed" },
    ]);
    expect((await get(`/v1/profiles/${alice.account}`)).body.counts).toEqual({ posts: 0, friends: 0, followers: 1, following: 0 });
  });
});

describe("community, sponsorship and registry projections", () => {
  it("applies policy_set, owner transfer proposals/cancellation/completion and role removal", async () => {
    const { body } = await get(`/v1/communities/${communityIdB64}`);
    expect(body).toMatchObject({
      id: communityIdB64,
      owner: bob.account,
      policyHash: toBase64url(sha256("policy-2")),
      policyUri: "ipfs://policy-2",
      pendingOwner: "",
      transferEffectiveAt: "0",
      createdAt: t100,
      updatedAt: t101,
    });
    expect(body.roles).toEqual([]);
    const forBob = (await get(`/v1/notifications/${bob.account}`)).body.items.map((n: { kind: string }) => n.kind);
    expect(forBob).toEqual(["friend_request", "role"]); // role none set by bob himself: no self-notification
  });

  it("applies sponsor_deactivated and user_grant_revoked", async () => {
    expect((await get("/v1/sponsors")).body.items).toEqual([{ sponsor, endpoint: "https://sponsor.example", policyVersion: 1, active: false, registeredAt: t100, updatedAt: t101 }]);
    const grant = indexer.db.get<{ revoked: number; daily_ops: number; updated_at: string }>("SELECT revoked, daily_ops, updated_at FROM user_grants WHERE sponsor = ? AND user = ?", sponsor, alice.account)!;
    expect(grant).toEqual({ revoked: 1, daily_ops: 10, updated_at: t101 });
  });

  it("applies contract_deprecated, contract_cancelled and the admin change", async () => {
    const { body } = await get("/v1/registry");
    expect(body.items).toEqual([
      { name: "identity", address: deployment.contracts.identity.address, version: 1, abiHash: toBase64url(sha256("abi-identity")), status: 2, effectiveAt: t101, updatedAt: t101 },
      { name: "publications", address: publicationsV2, version: 2, abiHash: toBase64url(sha256("abi-publications-2")), status: 1, effectiveAt: t101, updatedAt: t101 },
    ]);
    expect(indexer.db.getMeta("projection.registry.admin")).toBe(newAdmin);
    expect(indexer.db.getMeta("projection.registry.pending_admin")).toBeUndefined();
  });
});

describe("replay", () => {
  it("reproduces every view from the log", async () => {
    const before = await snapshot();
    expect(replayProjections(indexer.db)).toBe(45);
    expect(await snapshot()).toBe(before);
  });
});
