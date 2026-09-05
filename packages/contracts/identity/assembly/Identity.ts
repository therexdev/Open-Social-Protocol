// Open Social Protocol - identity contract (protocol v1).
//
// Canonical identity registry: encryption keys, profile references, expiring
// device/session authorities with capability bits and M-of-N guardian
// recovery under a delay. See docs/protocol-spec.md sections 3, 3.1-3.3 and
// ADR 0003. State is kept compact (identity_record, device_record,
// recovery_state); everything else is emitted as osp.identity.* events.
import { System, Storage, Protobuf, authority, Arrays } from "@koinos/sdk-as";
import { identity } from "./proto/identity";
import { Capability } from "./common/actor";
import { Util } from "./common/util";

// Call arguments and database reads are returned through the SDK's system-call
// buffer (1 KiB by default); the chain fails a call whose payload does not fit
// (publish envelopes are up to 4 KiB and key packages up to 16 KiB). Enlarged at
// module initialization: imported modules run their top-level statements before
// the generated index.ts calls main().
const SYSTEM_BUFFER_SIZE: u32 = 32 * 1024;
System.setSystemBufferSize(SYSTEM_BUFFER_SIZE);

// State spaces (one per map).
const IDENTITIES_SPACE: u32 = 1;
const DEVICES_SPACE: u32 = 2;
const RECOVERY_SPACE: u32 = 3;

// Protocol constants and pilot limits.
const PROTOCOL_VERSION: u32 = 1;
const ENCRYPTION_KEY_LENGTH: i32 = 32;
const HASH_LENGTH: i32 = 32;
const MAX_PROFILE_URI_CHARS: i32 = 512;
const MAX_LABEL_CHARS: i32 = 64;
const MAX_CAPABILITIES: u32 = 63; // all six capability bits set
const DAY_MS: u64 = 86_400_000;
const MAX_DEVICE_LIFETIME_MS: u64 = 366 * DAY_MS;
const MAX_RECOVERY_DELAY_MS: u64 = 365 * DAY_MS;
const MAX_GUARDIANS: i32 = 16;

export class Identity {
  contractId: Uint8Array;
  identities: Storage.Map<Uint8Array, identity.identity_record>;
  devices: Storage.Map<Uint8Array, identity.device_record>;
  recovery: Storage.Map<Uint8Array, identity.recovery_state>;

  constructor() {
    const contractId = System.getContractId();
    this.contractId = contractId;
    this.identities = new Storage.Map<Uint8Array, identity.identity_record>(
      contractId,
      IDENTITIES_SPACE,
      identity.identity_record.decode,
      identity.identity_record.encode,
      null
    );
    this.devices = new Storage.Map<Uint8Array, identity.device_record>(
      contractId,
      DEVICES_SPACE,
      identity.device_record.decode,
      identity.device_record.encode,
      null
    );
    this.recovery = new Storage.Map<Uint8Array, identity.recovery_state>(
      contractId,
      RECOVERY_SPACE,
      identity.recovery_state.decode,
      identity.recovery_state.encode,
      null
    );
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /** Storage key of a device record: account || device. */
  deviceKey(account: Uint8Array, device: Uint8Array): Uint8Array {
    return Util.concat([account, device]);
  }

  /** Load an identity record or revert. */
  loadIdentity(account: Uint8Array): identity.identity_record {
    const rec = this.identities.get(account);
    System.require(rec != null, "identity not registered");
    return rec!;
  }

  /** Require the current owner's contract_call authority; returns the owner. */
  requireOwner(rec: identity.identity_record): Uint8Array {
    const owner = rec.owner!;
    System.requireAuthority(authority.authorization_type.contract_call, owner);
    return owner;
  }

  /** Validate an optional profile hash (empty or 32 bytes); empty becomes null. */
  optionalHash(v: Uint8Array | null, what: string): Uint8Array | null {
    if (Util.isEmpty(v)) return null;
    System.require(v!.length == HASH_LENGTH, what + " must be empty or 32 bytes");
    return v;
  }

  /** Validate an optional string (max chars); empty becomes null. */
  optionalString(v: string | null, max: i32, what: string): string | null {
    const s = Util.requireString(v, max, what);
    return s.length == 0 ? null : s;
  }

  /** Validate an X25519 public key (exactly 32 bytes). */
  requireEncryptionKey(v: Uint8Array | null): Uint8Array {
    System.require(!Util.isEmpty(v), "encryption_key is required");
    System.require(v!.length == ENCRYPTION_KEY_LENGTH, "encryption_key must be 32 bytes");
    return v!;
  }

  /** True when `list` contains `addr`. */
  contains(list: Array<Uint8Array>, addr: Uint8Array): bool {
    for (let i = 0; i < list.length; i++) {
      if (Arrays.equal(list[i], addr)) return true;
    }
    return false;
  }

  /** Validate a recovery policy against the limits (guardians, threshold, delay). */
  validatePolicy(policy: identity.recovery_policy, account: Uint8Array): void {
    const guardians = policy.guardians;
    System.require(guardians.length >= 1, "at least one guardian is required");
    System.require(guardians.length <= MAX_GUARDIANS, "too many guardians");
    for (let i = 0; i < guardians.length; i++) {
      const g = Util.requireAddress(guardians[i], "guardian");
      System.require(!Arrays.equal(g, account), "guardian must differ from account");
      for (let j = 0; j < i; j++) {
        System.require(!Arrays.equal(guardians[j], g), "guardians must be distinct");
      }
    }
    System.require(policy.threshold >= 1, "threshold must be >= 1");
    System.require(policy.threshold <= <u32>guardians.length, "threshold exceeds guardian count");
    System.require(policy.delay_ms <= MAX_RECOVERY_DELAY_MS, "delay_ms too large");
  }

  /** Impacted list for policy events: account plus every guardian. */
  policyImpacted(account: Uint8Array, policy: identity.recovery_policy): Uint8Array[] {
    const impacted: Uint8Array[] = [account];
    for (let i = 0; i < policy.guardians.length; i++) impacted.push(policy.guardians[i]);
    return impacted;
  }

  /** Load the recovery state (never null; an empty state when unset). */
  loadRecovery(account: Uint8Array): identity.recovery_state {
    const state = this.recovery.get(account);
    if (state == null) return new identity.recovery_state(null, null, null);
    return state;
  }

  /** Emit osp.identity.recovery_cancelled (a pending recovery was voided). */
  emitRecoveryCancelled(account: Uint8Array, now: u64): void {
    const ev = new identity.recovery_cancelled_event(account, now);
    System.event("osp.identity.recovery_cancelled", Protobuf.encode(ev, identity.recovery_cancelled_event.encode), [account]);
  }

  /** Emit osp.identity.recovery_policy_cancelled (a pending policy change was voided). */
  emitPolicyCancelled(account: Uint8Array, now: u64): void {
    const ev = new identity.recovery_policy_cancelled_event(account, now);
    System.event("osp.identity.recovery_policy_cancelled", Protobuf.encode(ev, identity.recovery_policy_cancelled_event.encode), [account]);
  }

  /**
   * Actor resolution (spec 3.2). Never reverts: the result carries ok/reason
   * so calling contracts (and update_profile here) decide what to require.
   */
  resolve(
    account: Uint8Array | null,
    device: Uint8Array | null,
    capability: u32
  ): identity.resolve_actor_result {
    if (Util.isEmpty(account)) {
      return new identity.resolve_actor_result(false, null, "unregistered");
    }
    const rec = this.identities.get(account!);
    if (rec == null) {
      return new identity.resolve_actor_result(false, null, "unregistered");
    }
    if (Util.isEmpty(device) || Arrays.equal(device!, account!)) {
      return new identity.resolve_actor_result(true, rec.owner, null);
    }
    const dev = this.devices.get(this.deviceKey(account!, device!));
    if (dev == null) {
      return new identity.resolve_actor_result(false, null, "unknown device");
    }
    if (dev.revoked) {
      return new identity.resolve_actor_result(false, null, "device revoked");
    }
    if (dev.device_epoch != rec.device_epoch) {
      return new identity.resolve_actor_result(false, null, "device epoch expired");
    }
    if (dev.expires_at <= Util.now()) {
      return new identity.resolve_actor_result(false, null, "device expired");
    }
    if (capability != 0 && (dev.capabilities & capability) == 0) {
      return new identity.resolve_actor_result(false, null, "capability not granted");
    }
    return new identity.resolve_actor_result(true, device, null);
  }

  // ---------------------------------------------------------------------
  // Identity and keys
  // ---------------------------------------------------------------------

  register(args: identity.register_arguments): identity.register_result {
    const account = Util.requireAddress(args.account, "account");
    System.requireAuthority(authority.authorization_type.contract_call, account);
    System.require(this.identities.get(account) == null, "identity already registered");

    const key = this.requireEncryptionKey(args.encryption_key);
    System.require(args.key_version >= 1, "key_version must be >= 1");
    const profileHash = this.optionalHash(args.profile_hash, "profile_hash");
    const profileUri = this.optionalString(args.profile_uri, MAX_PROFILE_URI_CHARS, "profile_uri");

    const now = Util.now();
    const rec = new identity.identity_record(
      account,
      account,
      key,
      args.key_version,
      profileHash,
      profileUri,
      PROTOCOL_VERSION,
      0,
      now,
      now
    );
    this.identities.put(account, rec);

    const ev = new identity.registered_event(
      account,
      key,
      args.key_version,
      profileHash,
      profileUri,
      PROTOCOL_VERSION,
      now
    );
    System.event("osp.identity.registered", Protobuf.encode(ev, identity.registered_event.encode), [account]);
    return new identity.register_result();
  }

  update_profile(args: identity.update_profile_arguments): identity.update_profile_result {
    const account = Util.requireAddress(args.account, "account");
    const resolved = this.resolve(account, args.device, Capability.PROFILE);
    System.require(resolved.ok, resolved.reason != null ? resolved.reason! : "actor not authorized");
    System.requireAuthority(authority.authorization_type.contract_call, resolved.signer!);

    const rec = this.loadIdentity(account);
    const profileHash = this.optionalHash(args.profile_hash, "profile_hash");
    const profileUri = this.optionalString(args.profile_uri, MAX_PROFILE_URI_CHARS, "profile_uri");
    const now = Util.now();
    rec.profile_hash = profileHash;
    rec.profile_uri = profileUri;
    rec.updated_at = now;
    this.identities.put(account, rec);

    const ev = new identity.profile_updated_event(account, profileHash, profileUri, now);
    System.event("osp.identity.profile_updated", Protobuf.encode(ev, identity.profile_updated_event.encode), [account]);
    return new identity.update_profile_result();
  }

  rotate_encryption_key(
    args: identity.rotate_encryption_key_arguments
  ): identity.rotate_encryption_key_result {
    const account = Util.requireAddress(args.account, "account");
    const rec = this.loadIdentity(account);
    this.requireOwner(rec);

    const key = this.requireEncryptionKey(args.encryption_key);
    System.require(args.key_version > rec.key_version, "key_version must increase");

    const now = Util.now();
    const previous = rec.key_version;
    rec.encryption_key = key;
    rec.key_version = args.key_version;
    rec.updated_at = now;
    this.identities.put(account, rec);

    const ev = new identity.key_rotated_event(account, previous, key, args.key_version, now);
    System.event("osp.identity.key_rotated", Protobuf.encode(ev, identity.key_rotated_event.encode), [account]);
    return new identity.rotate_encryption_key_result();
  }

  // ---------------------------------------------------------------------
  // Devices
  // ---------------------------------------------------------------------

  authorize_device(args: identity.authorize_device_arguments): identity.authorize_device_result {
    const account = Util.requireAddress(args.account, "account");
    const rec = this.loadIdentity(account);
    this.requireOwner(rec);

    const device = Util.requireAddress(args.device, "device");
    System.require(!Arrays.equal(device, account), "device must differ from account");
    System.require(args.capabilities != 0, "capabilities must not be empty");
    System.require(args.capabilities <= MAX_CAPABILITIES, "unknown capability bits");
    const now = Util.now();
    System.require(args.expires_at > now, "expires_at must be in the future");
    System.require(args.expires_at <= now + MAX_DEVICE_LIFETIME_MS, "expires_at too far in the future");
    const label = this.optionalString(args.label, MAX_LABEL_CHARS, "label");

    const dev = new identity.device_record(
      account,
      device,
      args.capabilities,
      args.expires_at,
      rec.device_epoch,
      false,
      label,
      now
    );
    this.devices.put(this.deviceKey(account, device), dev);

    const ev = new identity.device_authorized_event(
      account,
      device,
      args.capabilities,
      args.expires_at,
      label,
      rec.device_epoch,
      now
    );
    System.event("osp.identity.device_authorized", Protobuf.encode(ev, identity.device_authorized_event.encode), [account, device]);
    return new identity.authorize_device_result();
  }

  revoke_device(args: identity.revoke_device_arguments): identity.revoke_device_result {
    const account = Util.requireAddress(args.account, "account");
    const rec = this.loadIdentity(account);
    this.requireOwner(rec);

    const device = Util.requireAddress(args.device, "device");
    const key = this.deviceKey(account, device);
    const dev = this.devices.get(key);
    System.require(dev != null, "unknown device");

    // Idempotent: revoking an already revoked device succeeds and re-emits the
    // event so a retried transaction never reverts.
    const now = Util.now();
    dev!.revoked = true;
    this.devices.put(key, dev!);

    const ev = new identity.device_revoked_event(account, device, now);
    System.event("osp.identity.device_revoked", Protobuf.encode(ev, identity.device_revoked_event.encode), [account, device]);
    return new identity.revoke_device_result();
  }

  // ---------------------------------------------------------------------
  // Recovery policy
  // ---------------------------------------------------------------------

  set_recovery_policy(
    args: identity.set_recovery_policy_arguments
  ): identity.set_recovery_policy_result {
    const account = Util.requireAddress(args.account, "account");
    const rec = this.loadIdentity(account);
    this.requireOwner(rec);

    System.require(args.policy != null, "policy is required");
    const policy = args.policy!;
    this.validatePolicy(policy, account);

    const now = Util.now();
    const state = this.loadRecovery(account);
    const impacted = this.policyImpacted(account, policy);

    if (state.policy == null) {
      // First policy applies immediately (spec 3.3).
      state.policy = policy;
      state.pending_policy = null;
      this.recovery.put(account, state);
      const ev = new identity.recovery_policy_set_event(account, policy, now);
      System.event("osp.identity.recovery_policy_set", Protobuf.encode(ev, identity.recovery_policy_set_event.encode), impacted);
    } else {
      // Later changes wait for the *current* policy's delay.
      const effectiveAt = now + state.policy!.delay_ms;
      state.pending_policy = new identity.pending_policy(policy, effectiveAt);
      this.recovery.put(account, state);
      const ev = new identity.recovery_policy_proposed_event(account, policy, effectiveAt);
      System.event("osp.identity.recovery_policy_proposed", Protobuf.encode(ev, identity.recovery_policy_proposed_event.encode), impacted);
    }
    return new identity.set_recovery_policy_result();
  }

  apply_recovery_policy(
    args: identity.apply_recovery_policy_arguments
  ): identity.apply_recovery_policy_result {
    const account = Util.requireAddress(args.account, "account");
    this.loadIdentity(account);

    const state = this.loadRecovery(account);
    System.require(state.pending_policy != null, "no pending recovery policy");
    const pending = state.pending_policy!;
    const now = Util.now();
    System.require(now >= pending.effective_at, "recovery policy delay not elapsed");

    const policy = pending.policy!;
    const voidedRecovery = state.pending_recovery != null;
    state.policy = policy;
    state.pending_policy = null;
    // A policy change voids any in-flight recovery: approvals were collected
    // under the old guardian set, so guardians the owner removed must never
    // count toward the new M-of-N threshold. Guardians of the new policy
    // simply propose again.
    state.pending_recovery = null;
    this.recovery.put(account, state);

    if (voidedRecovery) this.emitRecoveryCancelled(account, now);
    const ev = new identity.recovery_policy_set_event(account, policy, now);
    System.event("osp.identity.recovery_policy_set", Protobuf.encode(ev, identity.recovery_policy_set_event.encode), this.policyImpacted(account, policy));
    return new identity.apply_recovery_policy_result();
  }

  cancel_recovery_policy(
    args: identity.cancel_recovery_policy_arguments
  ): identity.cancel_recovery_policy_result {
    const account = Util.requireAddress(args.account, "account");
    const rec = this.loadIdentity(account);
    this.requireOwner(rec);

    const state = this.loadRecovery(account);
    System.require(state.pending_policy != null, "no pending recovery policy");
    state.pending_policy = null;
    this.recovery.put(account, state);

    this.emitPolicyCancelled(account, Util.now());
    return new identity.cancel_recovery_policy_result();
  }

  // ---------------------------------------------------------------------
  // Guardian recovery
  // ---------------------------------------------------------------------

  propose_recovery(args: identity.propose_recovery_arguments): identity.propose_recovery_result {
    const account = Util.requireAddress(args.account, "account");
    const guardian = Util.requireAddress(args.guardian, "guardian");
    System.requireAuthority(authority.authorization_type.contract_call, guardian);

    const rec = this.loadIdentity(account);
    const state = this.loadRecovery(account);
    System.require(state.policy != null, "no recovery policy");
    const policy = state.policy!;
    System.require(this.contains(policy.guardians, guardian), "not a guardian");

    const newOwner = Util.requireAddress(args.new_owner, "new_owner");
    System.require(!Arrays.equal(newOwner, rec.owner!), "new_owner must differ from current owner");

    const now = Util.now();
    const existing = state.pending_recovery;
    let pending: identity.pending_recovery;
    if (existing == null || !Arrays.equal(existing.new_owner!, newOwner)) {
      // Fresh proposal (or a different new_owner restarts the approval set).
      const approvals: Array<Uint8Array> = [guardian];
      pending = new identity.pending_recovery(newOwner, approvals, 0, now);
    } else {
      pending = existing;
      System.require(!this.contains(pending.approvals, guardian), "already approved");
      pending.approvals.push(guardian);
    }
    // effective_at is zero until the threshold is reached, then fixed.
    if (pending.effective_at == 0 && <u32>pending.approvals.length >= policy.threshold) {
      pending.effective_at = now + policy.delay_ms;
    }
    state.pending_recovery = pending;
    this.recovery.put(account, state);

    const ev = new identity.recovery_proposed_event(
      account,
      guardian,
      newOwner,
      <u32>pending.approvals.length,
      policy.threshold,
      pending.effective_at,
      now
    );
    System.event("osp.identity.recovery_proposed", Protobuf.encode(ev, identity.recovery_proposed_event.encode), [account, guardian, newOwner]);
    return new identity.propose_recovery_result();
  }

  cancel_recovery(args: identity.cancel_recovery_arguments): identity.cancel_recovery_result {
    const account = Util.requireAddress(args.account, "account");
    const rec = this.loadIdentity(account);
    this.requireOwner(rec);

    const state = this.loadRecovery(account);
    System.require(state.pending_recovery != null, "no pending recovery");
    state.pending_recovery = null;
    this.recovery.put(account, state);

    this.emitRecoveryCancelled(account, Util.now());
    return new identity.cancel_recovery_result();
  }

  execute_recovery(args: identity.execute_recovery_arguments): identity.execute_recovery_result {
    const account = Util.requireAddress(args.account, "account");
    const rec = this.loadIdentity(account);

    const state = this.loadRecovery(account);
    System.require(state.pending_recovery != null, "no pending recovery");
    const pending = state.pending_recovery!;
    System.require(pending.effective_at != 0, "recovery threshold not reached");
    const now = Util.now();
    System.require(now >= pending.effective_at, "recovery delay not elapsed");

    const previousOwner = rec.owner!;
    const newOwner = pending.new_owner!;
    rec.owner = newOwner;
    rec.device_epoch = rec.device_epoch + 1;
    rec.updated_at = now;
    this.identities.put(account, rec);

    const voidedPolicy = state.pending_policy != null;
    state.pending_recovery = null;
    // The previous owner's queued policy change must not outlive the recovery:
    // apply_recovery_policy is permissionless, so a change queued by a leaked
    // key (e.g. a single attacker guardian with zero delay) would otherwise be
    // applied under the new owner with no window to cancel it. The active
    // policy is kept.
    state.pending_policy = null;
    this.recovery.put(account, state);

    if (voidedPolicy) this.emitPolicyCancelled(account, now);
    const ev = new identity.recovered_event(account, previousOwner, newOwner, rec.device_epoch, now);
    System.event("osp.identity.recovered", Protobuf.encode(ev, identity.recovered_event.encode), [account, previousOwner, newOwner]);
    return new identity.execute_recovery_result();
  }

  // ---------------------------------------------------------------------
  // Read methods
  // ---------------------------------------------------------------------

  get_identity(args: identity.get_identity_arguments): identity.get_identity_result {
    if (Util.isEmpty(args.account)) return new identity.get_identity_result(null);
    return new identity.get_identity_result(this.identities.get(args.account!));
  }

  get_device(args: identity.get_device_arguments): identity.get_device_result {
    if (Util.isEmpty(args.account) || Util.isEmpty(args.device)) {
      return new identity.get_device_result(null);
    }
    return new identity.get_device_result(this.devices.get(this.deviceKey(args.account!, args.device!)));
  }

  get_recovery(args: identity.get_recovery_arguments): identity.get_recovery_result {
    if (Util.isEmpty(args.account)) return new identity.get_recovery_result(null);
    return new identity.get_recovery_result(this.recovery.get(args.account!));
  }

  resolve_actor(args: identity.resolve_actor_arguments): identity.resolve_actor_result {
    return this.resolve(args.account, args.device, args.capability);
  }
}
