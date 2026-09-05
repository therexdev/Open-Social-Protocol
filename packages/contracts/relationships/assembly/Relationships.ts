// Open Social Protocol - relationships contract (protocol v1).
//
// Mutual friendships (request/accept/remove), unilateral follows, blocks and
// the per-author friends-audience epoch. See docs/protocol-spec.md sections 4
// and 3.2, and ADR 0002/0003. Relationship state is public metadata by design.
//
// State is compact: one relationship_record per (sorted) pair, one
// block_record per (actor, target), one follow_record per (follower, target)
// and one audience_state per account. Everything else is emitted as
// osp.relationships.* events.
//
// Authority: every mutating method resolves its signer through the identity
// contract (identity.resolve_actor) and then requires that signer's
// contract_call authority on the current transaction. Methods that carry a
// `device` field accept a device key holding the RELATIONSHIPS capability;
// block/unblock are owner-only (no device field).
import { System, Storage, Protobuf, authority, Arrays } from "@koinos/sdk-as";
import { relationships } from "./proto/relationships";
import { Actor, Capability } from "./common/actor";
import { Util } from "./common/util";

// State spaces (one per map / object).
const RELATIONSHIPS_SPACE: u32 = 1;
const BLOCKS_SPACE: u32 = 2;
const FOLLOWS_SPACE: u32 = 3;
const AUDIENCES_SPACE: u32 = 4;
const CONFIG_SPACE: u32 = 5;

// Limits.
const KEY_PACKAGE_REF_LENGTH: i32 = 32;

// Audience rotation reasons (audience_rotated_event.reason).
const REASON_FRIEND_REMOVED: string = "friend_removed";
const REASON_BLOCKED: string = "blocked";
const REASON_MANUAL: string = "manual";

export class Relationships {
  contractId: Uint8Array;
  edges: Storage.Map<Uint8Array, relationships.relationship_record>;
  blocks: Storage.Map<Uint8Array, relationships.block_record>;
  follows: Storage.Map<Uint8Array, relationships.follow_record>;
  audiences: Storage.Map<Uint8Array, relationships.audience_state>;
  config: Storage.Obj<relationships.get_identity_contract_result>;

  constructor() {
    const contractId = System.getContractId();
    this.contractId = contractId;
    this.edges = new Storage.Map<Uint8Array, relationships.relationship_record>(
      contractId,
      RELATIONSHIPS_SPACE,
      relationships.relationship_record.decode,
      relationships.relationship_record.encode,
      null
    );
    this.blocks = new Storage.Map<Uint8Array, relationships.block_record>(
      contractId,
      BLOCKS_SPACE,
      relationships.block_record.decode,
      relationships.block_record.encode,
      null
    );
    this.follows = new Storage.Map<Uint8Array, relationships.follow_record>(
      contractId,
      FOLLOWS_SPACE,
      relationships.follow_record.decode,
      relationships.follow_record.encode,
      null
    );
    this.audiences = new Storage.Map<Uint8Array, relationships.audience_state>(
      contractId,
      AUDIENCES_SPACE,
      relationships.audience_state.decode,
      relationships.audience_state.encode,
      null
    );
    this.config = new Storage.Obj<relationships.get_identity_contract_result>(
      contractId,
      CONFIG_SPACE,
      relationships.get_identity_contract_result.decode,
      relationships.get_identity_contract_result.encode,
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

  /** Canonical pair key: min(a, b) || max(a, b) (lexicographic bytes). */
  pairKey(a: Uint8Array, b: Uint8Array): Uint8Array {
    return Util.compare(a, b) <= 0 ? Util.concat([a, b]) : Util.concat([b, a]);
  }

  /** Directional key: from || to (blocks and follows). */
  directedKey(from: Uint8Array, to: Uint8Array): Uint8Array {
    return Util.concat([from, to]);
  }

  /** True when `actor` currently blocks `target`. */
  hasBlocked(actor: Uint8Array, target: Uint8Array): bool {
    const rec = this.blocks.get(this.directedKey(actor, target));
    return rec != null && rec.blocked;
  }

  /** Revert when either party has blocked the other. */
  requireNotBlocked(actor: Uint8Array, other: Uint8Array, what: string): void {
    System.require(!this.hasBlocked(actor, other), what + " is blocked");
    System.require(!this.hasBlocked(other, actor), "blocked by " + what);
  }

  /** True when a follow edge follower -> target is active. */
  isFollowing(follower: Uint8Array, target: Uint8Array): bool {
    const rec = this.follows.get(this.directedKey(follower, target));
    return rec != null && rec.active;
  }

  /** Current audience state (epoch 0 when unset; never null). */
  loadAudience(account: Uint8Array): relationships.audience_state {
    const state = this.audiences.get(account);
    if (state == null) return new relationships.audience_state(0, 0);
    return state;
  }

  /** Advance the account's friends-audience epoch by one; returns the new epoch. */
  advanceEpoch(account: Uint8Array, now: u64): u32 {
    const state = this.loadAudience(account);
    state.epoch = state.epoch + 1;
    state.updated_at = now;
    this.audiences.put(account, state);
    return state.epoch;
  }

  /** Emit osp.relationships.audience_rotated. */
  emitAudienceRotated(account: Uint8Array, newEpoch: u32, reason: string, now: u64): void {
    const ev = new relationships.audience_rotated_event(account, newEpoch, reason, now);
    System.event(
      "osp.relationships.audience_rotated",
      Protobuf.encode(ev, relationships.audience_rotated_event.encode),
      [account]
    );
  }

  /** Validate an optional key package reference (empty or 32 bytes); empty becomes null. */
  optionalKeyPackageRef(v: Uint8Array | null): Uint8Array | null {
    if (Util.isEmpty(v)) return null;
    System.require(v!.length == KEY_PACKAGE_REF_LENGTH, "key_package_ref must be empty or 32 bytes");
    return v;
  }

  // ---------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------

  set_identity_contract(
    args: relationships.set_identity_contract_arguments
  ): relationships.set_identity_contract_result {
    System.requireAuthority(authority.authorization_type.contract_call, this.contractId);
    const address = Util.requireAddress(args.address, "address");
    this.config.put(new relationships.get_identity_contract_result(address));
    return new relationships.set_identity_contract_result();
  }

  // ---------------------------------------------------------------------
  // Friendships
  // ---------------------------------------------------------------------

  request_friend(
    args: relationships.request_friend_arguments
  ): relationships.request_friend_result {
    const requester = Util.requireAddress(args.requester, "requester");
    const recipient = Util.requireAddress(args.recipient, "recipient");
    System.require(!Arrays.equal(requester, recipient), "cannot friend yourself");

    const identityContract = this.identityContract();
    Actor.requireAuthorized(identityContract, requester, args.device, Capability.RELATIONSHIPS);
    System.require(Actor.exists(identityContract, recipient), "recipient not registered");
    this.requireNotBlocked(requester, recipient, "recipient");

    const key = this.pairKey(requester, recipient);
    const existing = this.edges.get(key);
    let nonce: u64 = 1;
    if (existing != null) {
      System.require(existing.status != relationships.relationship_status.pending, "already pending");
      System.require(existing.status != relationships.relationship_status.active, "already friends");
      nonce = existing.nonce + 1;
    }

    const now = Util.now();
    const first = Util.compare(requester, recipient) < 0 ? requester : recipient;
    const second = Util.compare(requester, recipient) < 0 ? recipient : requester;
    const rec = new relationships.relationship_record(
      first,
      second,
      relationships.relationship_status.pending,
      requester,
      nonce,
      now
    );
    this.edges.put(key, rec);

    const ev = new relationships.friend_requested_event(requester, recipient, nonce, now);
    System.event(
      "osp.relationships.friend_requested",
      Protobuf.encode(ev, relationships.friend_requested_event.encode),
      [requester, recipient]
    );
    return new relationships.request_friend_result();
  }

  accept_friend(
    args: relationships.accept_friend_arguments
  ): relationships.accept_friend_result {
    const approver = Util.requireAddress(args.approver, "approver");
    const requester = Util.requireAddress(args.requester, "requester");
    System.require(!Arrays.equal(approver, requester), "approver and requester must differ");

    Actor.requireAuthorized(this.identityContract(), approver, args.device, Capability.RELATIONSHIPS);
    const keyPackageRef = this.optionalKeyPackageRef(args.key_package_ref);

    const key = this.pairKey(approver, requester);
    const rec = this.edges.get(key);
    System.require(
      rec != null && rec.status == relationships.relationship_status.pending,
      "no pending request"
    );
    // The approver must be the party that did not send the request.
    System.require(Arrays.equal(rec!.requester!, requester), "requester mismatch");

    const now = Util.now();
    rec!.status = relationships.relationship_status.active;
    rec!.nonce = rec!.nonce + 1;
    rec!.updated_at = now;
    this.edges.put(key, rec!);

    const ev = new relationships.friend_accepted_event(approver, requester, rec!.nonce, keyPackageRef, now);
    System.event(
      "osp.relationships.friend_accepted",
      Protobuf.encode(ev, relationships.friend_accepted_event.encode),
      [approver, requester]
    );
    return new relationships.accept_friend_result();
  }

  remove_friend(
    args: relationships.remove_friend_arguments
  ): relationships.remove_friend_result {
    const actor = Util.requireAddress(args.actor, "actor");
    const peer = Util.requireAddress(args.peer, "peer");
    System.require(!Arrays.equal(actor, peer), "actor and peer must differ");

    Actor.requireAuthorized(this.identityContract(), actor, args.device, Capability.RELATIONSHIPS);

    const key = this.pairKey(actor, peer);
    const rec = this.edges.get(key);
    System.require(rec != null && rec.status == relationships.relationship_status.active, "not friends");

    const now = Util.now();
    rec!.status = relationships.relationship_status.inactive;
    rec!.nonce = rec!.nonce + 1;
    rec!.updated_at = now;
    this.edges.put(key, rec!);

    // The removed party must never receive future friends-only keys (spec 5.3).
    const newEpoch = this.advanceEpoch(actor, now);

    const ev = new relationships.friend_removed_event(actor, peer, rec!.nonce, newEpoch, now);
    System.event(
      "osp.relationships.friend_removed",
      Protobuf.encode(ev, relationships.friend_removed_event.encode),
      [actor, peer]
    );
    this.emitAudienceRotated(actor, newEpoch, REASON_FRIEND_REMOVED, now);
    return new relationships.remove_friend_result();
  }

  // ---------------------------------------------------------------------
  // Blocks (owner authority only)
  // ---------------------------------------------------------------------

  block(args: relationships.block_arguments): relationships.block_result {
    const actor = Util.requireAddress(args.actor, "actor");
    const target = Util.requireAddress(args.target, "target");
    System.require(!Arrays.equal(actor, target), "cannot block yourself");

    // No device field: only the identity owner may block (spec 3.1).
    Actor.requireAuthorized(this.identityContract(), actor, null, 0);

    const blockKey = this.directedKey(actor, target);
    System.require(!this.hasBlocked(actor, target), "already blocked");

    const now = Util.now();
    this.blocks.put(blockKey, new relationships.block_record(true, now));

    // Any pending or active friendship ends (no friend_removed event: the
    // blocked_event carries the nonce-bearing state change for indexers).
    const pairKey = this.pairKey(actor, target);
    const rec = this.edges.get(pairKey);
    if (
      rec != null &&
      (rec.status == relationships.relationship_status.pending ||
        rec.status == relationships.relationship_status.active)
    ) {
      rec.status = relationships.relationship_status.inactive;
      rec.nonce = rec.nonce + 1;
      rec.updated_at = now;
      this.edges.put(pairKey, rec);
    }

    // Follows are removed in both directions.
    this.follows.remove(this.directedKey(actor, target));
    this.follows.remove(this.directedKey(target, actor));

    const newEpoch = this.advanceEpoch(actor, now);

    const ev = new relationships.blocked_event(actor, target, newEpoch, now);
    System.event(
      "osp.relationships.blocked",
      Protobuf.encode(ev, relationships.blocked_event.encode),
      [actor, target]
    );
    this.emitAudienceRotated(actor, newEpoch, REASON_BLOCKED, now);
    return new relationships.block_result();
  }

  unblock(args: relationships.unblock_arguments): relationships.unblock_result {
    const actor = Util.requireAddress(args.actor, "actor");
    const target = Util.requireAddress(args.target, "target");
    System.require(!Arrays.equal(actor, target), "cannot unblock yourself");

    Actor.requireAuthorized(this.identityContract(), actor, null, 0);

    const blockKey = this.directedKey(actor, target);
    System.require(this.hasBlocked(actor, target), "not blocked");
    this.blocks.remove(blockKey);

    const now = Util.now();
    const ev = new relationships.unblocked_event(actor, target, now);
    System.event(
      "osp.relationships.unblocked",
      Protobuf.encode(ev, relationships.unblocked_event.encode),
      [actor, target]
    );
    return new relationships.unblock_result();
  }

  // ---------------------------------------------------------------------
  // Follows (unilateral)
  // ---------------------------------------------------------------------

  follow(args: relationships.follow_arguments): relationships.follow_result {
    const follower = Util.requireAddress(args.follower, "follower");
    const target = Util.requireAddress(args.target, "target");
    System.require(!Arrays.equal(follower, target), "cannot follow yourself");

    const identityContract = this.identityContract();
    Actor.requireAuthorized(identityContract, follower, args.device, Capability.RELATIONSHIPS);
    System.require(Actor.exists(identityContract, target), "target not registered");
    this.requireNotBlocked(follower, target, "target");
    System.require(!this.isFollowing(follower, target), "already following");

    const now = Util.now();
    this.follows.put(this.directedKey(follower, target), new relationships.follow_record(true, now));

    const ev = new relationships.followed_event(follower, target, now);
    System.event(
      "osp.relationships.followed",
      Protobuf.encode(ev, relationships.followed_event.encode),
      [follower, target]
    );
    return new relationships.follow_result();
  }

  unfollow(args: relationships.unfollow_arguments): relationships.unfollow_result {
    const follower = Util.requireAddress(args.follower, "follower");
    const target = Util.requireAddress(args.target, "target");
    System.require(!Arrays.equal(follower, target), "cannot unfollow yourself");

    Actor.requireAuthorized(this.identityContract(), follower, args.device, Capability.RELATIONSHIPS);
    System.require(this.isFollowing(follower, target), "not following");
    this.follows.remove(this.directedKey(follower, target));

    const now = Util.now();
    const ev = new relationships.unfollowed_event(follower, target, now);
    System.event(
      "osp.relationships.unfollowed",
      Protobuf.encode(ev, relationships.unfollowed_event.encode),
      [follower, target]
    );
    return new relationships.unfollow_result();
  }

  // ---------------------------------------------------------------------
  // Audience epoch
  // ---------------------------------------------------------------------

  rotate_audience(
    args: relationships.rotate_audience_arguments
  ): relationships.rotate_audience_result {
    const actor = Util.requireAddress(args.actor, "actor");
    Actor.requireAuthorized(this.identityContract(), actor, args.device, Capability.RELATIONSHIPS);

    const now = Util.now();
    const newEpoch = this.advanceEpoch(actor, now);
    this.emitAudienceRotated(actor, newEpoch, REASON_MANUAL, now);
    return new relationships.rotate_audience_result();
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  get_relationship(
    args: relationships.get_relationship_arguments
  ): relationships.get_relationship_result {
    const res = new relationships.get_relationship_result();
    if (Util.isEmpty(args.a) || Util.isEmpty(args.b)) return res;
    res.value = this.edges.get(this.pairKey(args.a!, args.b!));
    return res;
  }

  get_audience(
    args: relationships.get_audience_arguments
  ): relationships.get_audience_result {
    const res = new relationships.get_audience_result();
    if (Util.isEmpty(args.account)) {
      res.value = new relationships.audience_state(0, 0);
      return res;
    }
    res.value = this.loadAudience(args.account!);
    return res;
  }

  is_blocked(
    args: relationships.is_blocked_arguments
  ): relationships.is_blocked_result {
    const res = new relationships.is_blocked_result(false);
    if (Util.isEmpty(args.actor) || Util.isEmpty(args.target)) return res;
    res.value = this.hasBlocked(args.actor!, args.target!);
    return res;
  }

  get_follow(
    args: relationships.get_follow_arguments
  ): relationships.get_follow_result {
    const res = new relationships.get_follow_result();
    if (Util.isEmpty(args.follower) || Util.isEmpty(args.target)) return res;
    res.value = this.follows.get(this.directedKey(args.follower!, args.target!));
    return res;
  }

  get_identity_contract(
    args: relationships.get_identity_contract_arguments
  ): relationships.get_identity_contract_result {
    const cfg = this.config.get();
    if (cfg == null) return new relationships.get_identity_contract_result(null);
    return cfg;
  }
}
