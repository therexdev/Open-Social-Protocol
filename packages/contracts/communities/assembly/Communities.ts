// Open Social Protocol - communities contract (protocol v1).
//
// Optional community layer over the base identity / relationship / publication
// facts: signed roles with scope and expiry, policy references, moderation
// labels and time-locked ownership transfer. See docs/protocol-spec.md
// sections 9 (communities), 3.1-3.2 (authority classes, actor resolution) and
// 12 (events), plus ADR 0002 / ADR 0003.
//
// Communities never invalidate an underlying signed publication: labels are
// pure moderation facts emitted as events, and roles are admission / ranking
// facts that clients and indexers may honour.
//
// State is compact: one community_record per community id and one role_record
// per (community, subject). Labels and every other history fact live only in
// osp.communities.* events.
//
// Authority: every mutating method resolves its signer through the identity
// contract (identity.resolve_actor) and then requires that signer's
// contract_call authority on the current transaction. Methods that carry a
// `device` field accept a device key holding the COMMUNITY capability;
// community creation and ownership transfer proposals / cancellations are
// owner-key only (device empty, capability 0). execute_owner_transfer is
// permissionless once the time-lock has elapsed.
import { System, Storage, Protobuf, authority, Arrays } from "@koinos/sdk-as";
import { communities } from "./proto/communities";
import { Actor, Capability } from "./common/actor";
import { Util } from "./common/util";

// State spaces (one per map / object).
const COMMUNITIES_SPACE: u32 = 1;
const ROLES_SPACE: u32 = 2;
const CONFIG_SPACE: u32 = 3;

// Limits.
const ID_MAX_LENGTH: i32 = 32;
const NAME_MAX_LENGTH: i32 = 64;
const POLICY_HASH_LENGTH: i32 = 32;
const POLICY_URI_MAX_LENGTH: i32 = 256;
const SCOPE_MAX_LENGTH: i32 = 32;
const POST_ID_LENGTH: i32 = 32;
const LABEL_MAX_LENGTH: i32 = 64;
const REASON_MAX_LENGTH: i32 = 256;
// 30 days in milliseconds.
const TRANSFER_DELAY_MAX_MS: u64 = 30 * 24 * 60 * 60 * 1000;

// Role ranks: guest(1) < member(2) < moderator(3) < admin(4) < owner(5);
// banned(6) and none(0) rank 0 for permission checks.
const RANK_NONE: i32 = 0;
const RANK_MODERATOR: i32 = 3;
const RANK_ADMIN: i32 = 4;
const RANK_OWNER: i32 = 5;
const ROLE_MAX_VALUE: i32 = 6;

export class Communities {
  contractId: Uint8Array;
  communities: Storage.Map<Uint8Array, communities.community_record>;
  roles: Storage.Map<Uint8Array, communities.role_record>;
  config: Storage.Obj<communities.get_identity_contract_result>;

  constructor() {
    const contractId = System.getContractId();
    this.contractId = contractId;
    this.communities = new Storage.Map<Uint8Array, communities.community_record>(
      contractId,
      COMMUNITIES_SPACE,
      communities.community_record.decode,
      communities.community_record.encode,
      null
    );
    this.roles = new Storage.Map<Uint8Array, communities.role_record>(
      contractId,
      ROLES_SPACE,
      communities.role_record.decode,
      communities.role_record.encode,
      null
    );
    this.config = new Storage.Obj<communities.get_identity_contract_result>(
      contractId,
      CONFIG_SPACE,
      communities.get_identity_contract_result.decode,
      communities.get_identity_contract_result.encode,
      null
    );
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /** Configured identity contract address, or empty bytes when unset. */
  identityContract(): Uint8Array {
    const cfg = this.config.get();
    if (cfg == null || Util.isEmpty(cfg.value)) return new Uint8Array(0);
    return cfg.value!;
  }

  /** Role key: community_id || subject (subject is a fixed 25-byte address, so keys never collide). */
  roleKey(communityId: Uint8Array, subject: Uint8Array): Uint8Array {
    return Util.concat([communityId, subject]);
  }

  /** Load a community or revert. */
  requireCommunity(id: Uint8Array): communities.community_record {
    const rec = this.communities.get(id);
    System.require(rec != null, "community not found");
    return rec!;
  }

  /** Permission rank of a role: banned and none rank 0. */
  rank(role: communities.community_role): i32 {
    if (role == communities.community_role.banned) return RANK_NONE;
    if (role == communities.community_role.none) return RANK_NONE;
    return <i32>role;
  }

  /**
   * Effective role of `account` in `community` at `now`: owner when the account
   * is the community owner; otherwise the stored role when present, unexpired
   * (expires_at == 0 or > now) and not none; otherwise none.
   */
  effectiveRole(
    community: communities.community_record,
    account: Uint8Array,
    now: u64
  ): communities.community_role {
    if (Arrays.equal(community.owner!, account)) return communities.community_role.owner;
    const rec = this.roles.get(this.roleKey(community.id!, account));
    if (rec == null) return communities.community_role.none;
    if (rec.expires_at != 0 && rec.expires_at <= now) return communities.community_role.none;
    return rec.role;
  }

  /** Effective permission rank of `account` in `community`. */
  effectiveRank(community: communities.community_record, account: Uint8Array, now: u64): i32 {
    return this.rank(this.effectiveRole(community, account, now));
  }

  /** Validate a community id (1..32 bytes). */
  requireCommunityId(v: Uint8Array | null): Uint8Array {
    return Util.requireBytes(v, ID_MAX_LENGTH, "community id");
  }

  /** Validate an optional policy hash (empty or 32 bytes); empty becomes null. */
  optionalPolicyHash(v: Uint8Array | null): Uint8Array | null {
    if (Util.isEmpty(v)) return null;
    System.require(v!.length == POLICY_HASH_LENGTH, "policy_hash must be empty or 32 bytes");
    return v;
  }

  /** Validate an optional policy uri (<= 256 chars); empty becomes null. */
  optionalPolicyUri(v: string | null): string | null {
    const s = Util.requireString(v, POLICY_URI_MAX_LENGTH, "policy_uri");
    return s.length == 0 ? null : s;
  }

  /** Validate an optional role scope (<= 32 bytes); empty becomes null. */
  optionalScope(v: Uint8Array | null): Uint8Array | null {
    if (Util.isEmpty(v)) return null;
    System.require(v!.length <= SCOPE_MAX_LENGTH, "scope too large");
    return v;
  }

  // ---------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------

  set_identity_contract(
    args: communities.set_identity_contract_arguments
  ): communities.set_identity_contract_result {
    System.requireAuthority(authority.authorization_type.contract_call, this.contractId);
    const address = Util.requireAddress(args.address, "address");
    this.config.put(new communities.get_identity_contract_result(address));
    return new communities.set_identity_contract_result();
  }

  // ---------------------------------------------------------------------
  // Community lifecycle
  // ---------------------------------------------------------------------

  create_community(
    args: communities.create_community_arguments
  ): communities.create_community_result {
    const creator = Util.requireAddress(args.creator, "creator");
    const id = this.requireCommunityId(args.id);
    const name = Util.requireString(args.name, NAME_MAX_LENGTH, "name");
    System.require(name.length > 0, "name is required");
    const policyHash = this.optionalPolicyHash(args.policy_hash);
    const policyUri = this.optionalPolicyUri(args.policy_uri);
    System.require(args.transfer_delay_ms <= TRANSFER_DELAY_MAX_MS, "transfer_delay_ms too large");

    // Creation is an owner-key action: the device field is ignored (spec 3.1).
    Actor.requireAuthorized(this.identityContract(), creator, null, 0);
    System.require(!this.communities.has(id), "community id already exists");

    const now = Util.now();
    const rec = new communities.community_record(
      id,
      creator,
      name,
      policyHash,
      policyUri,
      args.transfer_delay_ms,
      null,
      0,
      now,
      now
    );
    this.communities.put(id, rec);

    const ev = new communities.community_created_event(
      id,
      creator,
      name,
      policyHash,
      policyUri,
      args.transfer_delay_ms,
      now
    );
    System.event(
      "osp.communities.community_created",
      Protobuf.encode(ev, communities.community_created_event.encode),
      [creator]
    );
    return new communities.create_community_result();
  }

  // ---------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------

  set_role(args: communities.set_role_arguments): communities.set_role_result {
    const communityId = this.requireCommunityId(args.community_id);
    const actor = Util.requireAddress(args.actor, "actor");
    const subject = Util.requireAddress(args.subject, "subject");
    const role = args.role;
    System.require(<i32>role >= 0 && <i32>role <= ROLE_MAX_VALUE, "invalid role");
    const scope = this.optionalScope(args.scope);
    const now = Util.now();
    System.require(args.expires_at == 0 || args.expires_at > now, "expires_at must be 0 or in the future");

    const community = this.requireCommunity(communityId);
    Actor.requireAuthorized(this.identityContract(), actor, args.device, Capability.COMMUNITY);

    const actorRank = this.effectiveRank(community, actor, now);
    System.require(actorRank >= RANK_ADMIN, "insufficient role");
    System.require(!Arrays.equal(community.owner!, subject), "cannot change owner role");
    System.require(role != communities.community_role.owner, "use ownership transfer");
    if (actorRank < RANK_OWNER) {
      // Admins only manage roles strictly below admin, for subjects below admin.
      System.require(this.rank(role) < RANK_ADMIN, "admin may only set roles below admin");
      System.require(
        this.effectiveRank(community, subject, now) < RANK_ADMIN,
        "admin cannot change an admin's role"
      );
    }

    const key = this.roleKey(communityId, subject);
    if (role == communities.community_role.none) {
      this.roles.remove(key);
    } else {
      this.roles.put(key, new communities.role_record(role, scope, args.expires_at, actor, now));
    }

    const ev = new communities.role_set_event(communityId, actor, subject, role, scope, args.expires_at, now);
    System.event(
      "osp.communities.role_set",
      Protobuf.encode(ev, communities.role_set_event.encode),
      [actor, subject]
    );
    return new communities.set_role_result();
  }

  // ---------------------------------------------------------------------
  // Policy
  // ---------------------------------------------------------------------

  set_policy(
    args: communities.set_policy_arguments
  ): communities.set_policy_result {
    const communityId = this.requireCommunityId(args.community_id);
    const actor = Util.requireAddress(args.actor, "actor");
    const policyHash = this.optionalPolicyHash(args.policy_hash);
    const policyUri = this.optionalPolicyUri(args.policy_uri);

    const community = this.requireCommunity(communityId);
    Actor.requireAuthorized(this.identityContract(), actor, args.device, Capability.COMMUNITY);

    const now = Util.now();
    System.require(this.effectiveRank(community, actor, now) >= RANK_ADMIN, "insufficient role");

    community.policy_hash = policyHash;
    community.policy_uri = policyUri;
    community.updated_at = now;
    this.communities.put(communityId, community);

    const ev = new communities.policy_set_event(communityId, actor, policyHash, policyUri, now);
    System.event(
      "osp.communities.policy_set",
      Protobuf.encode(ev, communities.policy_set_event.encode),
      [actor]
    );
    return new communities.set_policy_result();
  }

  // ---------------------------------------------------------------------
  // Ownership transfer (time-locked)
  // ---------------------------------------------------------------------

  propose_owner_transfer(
    args: communities.propose_owner_transfer_arguments
  ): communities.propose_owner_transfer_result {
    const communityId = this.requireCommunityId(args.community_id);
    const owner = Util.requireAddress(args.owner, "owner");
    const newOwner = Util.requireAddress(args.new_owner, "new_owner");
    System.require(!Arrays.equal(owner, newOwner), "new_owner must differ from owner");

    const community = this.requireCommunity(communityId);
    System.require(Arrays.equal(community.owner!, owner), "only the owner may propose a transfer");
    // Owner-key only: no device field (spec 3.1).
    Actor.requireAuthorized(this.identityContract(), owner, null, 0);

    const now = Util.now();
    const effectiveAt = now + community.transfer_delay_ms;
    community.pending_owner = newOwner;
    community.transfer_effective_at = effectiveAt;
    community.updated_at = now;
    this.communities.put(communityId, community);

    const ev = new communities.owner_transfer_proposed_event(communityId, owner, newOwner, effectiveAt);
    System.event(
      "osp.communities.owner_transfer_proposed",
      Protobuf.encode(ev, communities.owner_transfer_proposed_event.encode),
      [owner, newOwner]
    );
    return new communities.propose_owner_transfer_result();
  }

  cancel_owner_transfer(
    args: communities.cancel_owner_transfer_arguments
  ): communities.cancel_owner_transfer_result {
    const communityId = this.requireCommunityId(args.community_id);
    const owner = Util.requireAddress(args.owner, "owner");

    const community = this.requireCommunity(communityId);
    System.require(Arrays.equal(community.owner!, owner), "only the owner may cancel a transfer");
    Actor.requireAuthorized(this.identityContract(), owner, null, 0);
    System.require(!Util.isEmpty(community.pending_owner), "no pending transfer");

    const pendingOwner = community.pending_owner!;
    const now = Util.now();
    community.pending_owner = null;
    community.transfer_effective_at = 0;
    community.updated_at = now;
    this.communities.put(communityId, community);

    const ev = new communities.owner_transfer_cancelled_event(communityId, now);
    System.event(
      "osp.communities.owner_transfer_cancelled",
      Protobuf.encode(ev, communities.owner_transfer_cancelled_event.encode),
      [owner, pendingOwner]
    );
    return new communities.cancel_owner_transfer_result();
  }

  execute_owner_transfer(
    args: communities.execute_owner_transfer_arguments
  ): communities.execute_owner_transfer_result {
    const communityId = this.requireCommunityId(args.community_id);
    const community = this.requireCommunity(communityId);
    System.require(!Util.isEmpty(community.pending_owner), "no pending transfer");

    const now = Util.now();
    System.require(now >= community.transfer_effective_at, "transfer delay not elapsed");

    const previousOwner = community.owner!;
    const newOwner = community.pending_owner!;
    community.owner = newOwner;
    community.pending_owner = null;
    community.transfer_effective_at = 0;
    community.updated_at = now;
    this.communities.put(communityId, community);
    // The owner role is implicit; any explicit role of the new owner is dropped.
    this.roles.remove(this.roleKey(communityId, newOwner));

    const ev = new communities.owner_transferred_event(communityId, previousOwner, newOwner, now);
    System.event(
      "osp.communities.owner_transferred",
      Protobuf.encode(ev, communities.owner_transferred_event.encode),
      [previousOwner, newOwner]
    );
    return new communities.execute_owner_transfer_result();
  }

  // ---------------------------------------------------------------------
  // Moderation labels (events only)
  // ---------------------------------------------------------------------

  set_label(
    args: communities.set_label_arguments
  ): communities.set_label_result {
    const communityId = this.requireCommunityId(args.community_id);
    const actor = Util.requireAddress(args.actor, "actor");
    const postId = Util.requireBytes(args.post_id, POST_ID_LENGTH, "post_id");
    System.require(postId.length == POST_ID_LENGTH, "post_id must be 32 bytes");
    const label = Util.requireString(args.label, LABEL_MAX_LENGTH, "label");
    System.require(label.length > 0, "label is required");
    const reason = Util.requireString(args.reason, REASON_MAX_LENGTH, "reason");

    const community = this.requireCommunity(communityId);
    Actor.requireAuthorized(this.identityContract(), actor, args.device, Capability.COMMUNITY);

    const now = Util.now();
    System.require(this.effectiveRank(community, actor, now) >= RANK_MODERATOR, "insufficient role");

    const ev = new communities.label_set_event(
      communityId,
      actor,
      postId,
      label,
      reason.length == 0 ? null : reason,
      now
    );
    System.event(
      "osp.communities.label_set",
      Protobuf.encode(ev, communities.label_set_event.encode),
      [actor]
    );
    return new communities.set_label_result();
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  get_community(
    args: communities.get_community_arguments
  ): communities.get_community_result {
    const res = new communities.get_community_result();
    if (Util.isEmpty(args.id)) return res;
    res.value = this.communities.get(args.id!);
    return res;
  }

  get_role(args: communities.get_role_arguments): communities.get_role_result {
    const res = new communities.get_role_result();
    if (Util.isEmpty(args.community_id) || Util.isEmpty(args.subject)) return res;
    res.value = this.roles.get(this.roleKey(args.community_id!, args.subject!));
    return res;
  }

  get_identity_contract(
    args: communities.get_identity_contract_arguments
  ): communities.get_identity_contract_result {
    const cfg = this.config.get();
    if (cfg == null) return new communities.get_identity_contract_result(null);
    return cfg;
  }
}
