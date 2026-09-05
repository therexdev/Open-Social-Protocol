// Open Social Protocol - registry contract (protocol v1).
//
// Well-known discovery point for the current contract set (spec section 13,
// ADR 0002). Every change to the active set is a published, time-locked
// proposal: the admin proposes a (name, address, version) entry, anyone may
// apply it once `upgrade_delay_ms` has elapsed, and the admin may cancel it
// before that. Bootstrap (no active entry for a name yet) activates
// immediately so a fresh deployment can publish its initial set. Deprecation
// is a signal only: deprecated entries remain readable. The admin key itself
// moves through the same time lock (propose_admin / execute_admin).
//
// State is compact: one registry_config object plus one contract_entry per
// name in the active and proposed maps. Everything else is emitted as
// osp.registry.* events.
import { System, Storage, Protobuf, authority, Arrays } from "@koinos/sdk-as";
import { registry } from "./proto/registry";
import { Util } from "./common/util";

// State spaces (one per map / object).
const CONFIG_SPACE: u32 = 1;
const ACTIVE_SPACE: u32 = 2;
const PROPOSED_SPACE: u32 = 3;

// Limits.
const DAY_MS: u64 = 86_400_000;
const MAX_UPGRADE_DELAY_MS: u64 = 30 * DAY_MS;
const MAX_NAME_CHARS: i32 = 32;
const ABI_HASH_LENGTH: i32 = 32;
const MAX_NOTES_CHARS: i32 = 256;
const MAX_LIST_LIMIT: i32 = 100;

export class Registry {
  contractId: Uint8Array;
  config: Storage.Obj<registry.registry_config>;
  active: Storage.Map<Uint8Array, registry.contract_entry>;
  proposed: Storage.Map<Uint8Array, registry.contract_entry>;

  constructor() {
    const contractId = System.getContractId();
    this.contractId = contractId;
    this.config = new Storage.Obj<registry.registry_config>(
      contractId,
      CONFIG_SPACE,
      registry.registry_config.decode,
      registry.registry_config.encode,
      null
    );
    this.active = new Storage.Map<Uint8Array, registry.contract_entry>(
      contractId,
      ACTIVE_SPACE,
      registry.contract_entry.decode,
      registry.contract_entry.encode,
      null
    );
    this.proposed = new Storage.Map<Uint8Array, registry.contract_entry>(
      contractId,
      PROPOSED_SPACE,
      registry.contract_entry.decode,
      registry.contract_entry.encode,
      null
    );
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /** Load the configuration or revert when init has not run. */
  loadConfig(): registry.registry_config {
    const cfg = this.config.get();
    System.require(cfg != null, "not initialized");
    return cfg!;
  }

  /** Require the current admin's contract_call authority; returns the config. */
  requireAdmin(): registry.registry_config {
    const cfg = this.loadConfig();
    System.requireAuthority(authority.authorization_type.contract_call, cfg.admin!);
    return cfg;
  }

  /** Validate a contract name: 1..32 characters of [a-z0-9_-]. */
  requireName(v: string | null): string {
    System.require(v != null && v!.length > 0, "name is required");
    const name = v!;
    System.require(name.length <= MAX_NAME_CHARS, "name too long");
    for (let i = 0; i < name.length; i++) {
      const c = name.charCodeAt(i);
      const ok =
        (c >= 0x61 && c <= 0x7a) || // a-z
        (c >= 0x30 && c <= 0x39) || // 0-9
        c == 0x5f || // _
        c == 0x2d; // -
      System.require(ok, "name must match [a-z0-9_-]");
    }
    return name;
  }

  /** Storage key of a contract entry (both maps): the raw name bytes. */
  nameKey(name: string): Uint8Array {
    return Util.str(name);
  }

  /** Validate an optional ABI hash (empty or 32 bytes); empty becomes null. */
  optionalAbiHash(v: Uint8Array | null): Uint8Array | null {
    if (Util.isEmpty(v)) return null;
    System.require(v!.length == ABI_HASH_LENGTH, "abi_hash must be empty or 32 bytes");
    return v;
  }

  /** Validate optional notes (max 256 chars); empty becomes null. */
  optionalNotes(v: string | null): string | null {
    const s = Util.requireString(v, MAX_NOTES_CHARS, "notes");
    return s.length == 0 ? null : s;
  }

  /** Impacted list of two addresses, deduplicated when equal. */
  impacted(a: Uint8Array, b: Uint8Array): Uint8Array[] {
    if (Arrays.equal(a, b)) return [a];
    return [a, b];
  }

  /** Emit osp.registry.contract_activated for an entry that just became active. */
  emitActivated(entry: registry.contract_entry, now: u64, impacted: Uint8Array[]): void {
    const ev = new registry.contract_activated_event(entry.name, entry.address, entry.version, now);
    System.event(
      "osp.registry.contract_activated",
      Protobuf.encode(ev, registry.contract_activated_event.encode),
      impacted
    );
  }

  // ---------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------

  init(args: registry.init_arguments): registry.init_result {
    // Only the registry's own account may initialize it, exactly once.
    System.requireAuthority(authority.authorization_type.contract_call, this.contractId);
    System.require(this.config.get() == null, "already initialized");

    const admin = Util.requireAddress(args.admin, "admin");
    System.require(args.upgrade_delay_ms <= MAX_UPGRADE_DELAY_MS, "upgrade_delay_ms too large");
    System.require(args.protocol_version >= 1, "protocol_version must be >= 1");

    this.config.put(new registry.registry_config(admin, args.upgrade_delay_ms, args.protocol_version, null, 0));
    return new registry.init_result();
  }

  // ---------------------------------------------------------------------
  // Contract entries
  // ---------------------------------------------------------------------

  propose_contract(
    args: registry.propose_contract_arguments
  ): registry.propose_contract_result {
    const cfg = this.requireAdmin();
    const admin = cfg.admin!;
    const name = this.requireName(args.name);
    const address = Util.requireAddress(args.address, "address");
    System.require(args.version >= 1, "version must be >= 1");
    const abiHash = this.optionalAbiHash(args.abi_hash);
    const notes = this.optionalNotes(args.notes);

    const key = this.nameKey(name);
    const now = Util.now();
    const current = this.active.get(key);

    if (current == null) {
      // Bootstrap: nothing is active under this name yet, activate immediately.
      const entry = new registry.contract_entry(
        name,
        address,
        args.version,
        abiHash,
        registry.contract_status.active,
        now,
        notes,
        now
      );
      this.active.put(key, entry);
      this.emitActivated(entry, now, this.impacted(address, admin));
      return new registry.propose_contract_result();
    }

    // Upgrade: time-locked proposal; a newer proposal replaces a pending one
    // and restarts the delay.
    System.require(args.version > current.version, "version must be greater than the active version");
    const effectiveAt = now + cfg.upgrade_delay_ms;
    const entry = new registry.contract_entry(
      name,
      address,
      args.version,
      abiHash,
      registry.contract_status.proposed,
      effectiveAt,
      notes,
      now
    );
    this.proposed.put(key, entry);

    const ev = new registry.contract_proposed_event(name, address, args.version, abiHash, effectiveAt);
    System.event(
      "osp.registry.contract_proposed",
      Protobuf.encode(ev, registry.contract_proposed_event.encode),
      this.impacted(address, admin)
    );
    return new registry.propose_contract_result();
  }

  apply_contract(
    args: registry.apply_contract_arguments
  ): registry.apply_contract_result {
    // Anyone may apply once the delay has elapsed; no signature required.
    this.loadConfig();
    const name = this.requireName(args.name);
    const key = this.nameKey(name);
    const pending = this.proposed.get(key);
    System.require(pending != null, "no proposed entry for name");
    const entry = pending!;
    const now = Util.now();
    System.require(now >= entry.effective_at, "upgrade delay has not elapsed");

    entry.status = registry.contract_status.active;
    entry.updated_at = now;
    this.active.put(key, entry);
    this.proposed.remove(key);

    this.emitActivated(entry, now, [entry.address!]);
    return new registry.apply_contract_result();
  }

  cancel_contract(
    args: registry.cancel_contract_arguments
  ): registry.cancel_contract_result {
    const cfg = this.requireAdmin();
    const name = this.requireName(args.name);
    const key = this.nameKey(name);
    const pending = this.proposed.get(key);
    System.require(pending != null, "no proposed entry for name");

    this.proposed.remove(key);

    const now = Util.now();
    const ev = new registry.contract_cancelled_event(name, now);
    System.event(
      "osp.registry.contract_cancelled",
      Protobuf.encode(ev, registry.contract_cancelled_event.encode),
      this.impacted(pending!.address!, cfg.admin!)
    );
    return new registry.cancel_contract_result();
  }

  deprecate_contract(
    args: registry.deprecate_contract_arguments
  ): registry.deprecate_contract_result {
    const cfg = this.requireAdmin();
    const name = this.requireName(args.name);
    const notes = this.optionalNotes(args.notes);
    const key = this.nameKey(name);
    const current = this.active.get(key);
    System.require(current != null, "no active entry for name");
    const entry = current!;
    System.require(entry.status != registry.contract_status.deprecated, "contract already deprecated");

    const now = Util.now();
    entry.status = registry.contract_status.deprecated;
    entry.notes = notes;
    entry.updated_at = now;
    this.active.put(key, entry);

    const ev = new registry.contract_deprecated_event(name, entry.address, entry.version, now);
    System.event(
      "osp.registry.contract_deprecated",
      Protobuf.encode(ev, registry.contract_deprecated_event.encode),
      this.impacted(entry.address!, cfg.admin!)
    );
    return new registry.deprecate_contract_result();
  }

  // ---------------------------------------------------------------------
  // Admin transfer
  // ---------------------------------------------------------------------

  propose_admin(
    args: registry.propose_admin_arguments
  ): registry.propose_admin_result {
    const cfg = this.requireAdmin();
    const admin = cfg.admin!;
    const newAdmin = Util.requireAddress(args.new_admin, "new_admin");
    System.require(!Arrays.equal(newAdmin, admin), "new_admin must differ from the current admin");

    // A newer proposal replaces a pending one and restarts the delay.
    const effectiveAt = Util.now() + cfg.upgrade_delay_ms;
    cfg.pending_admin = newAdmin;
    cfg.admin_transfer_effective_at = effectiveAt;
    this.config.put(cfg);

    const ev = new registry.admin_proposed_event(newAdmin, effectiveAt);
    System.event(
      "osp.registry.admin_proposed",
      Protobuf.encode(ev, registry.admin_proposed_event.encode),
      [newAdmin, admin]
    );
    return new registry.propose_admin_result();
  }

  cancel_admin(args: registry.cancel_admin_arguments): registry.cancel_admin_result {
    const cfg = this.requireAdmin();
    System.require(!Util.isEmpty(cfg.pending_admin), "no pending admin transfer");

    cfg.pending_admin = null;
    cfg.admin_transfer_effective_at = 0;
    this.config.put(cfg);
    return new registry.cancel_admin_result();
  }

  execute_admin(args: registry.execute_admin_arguments): registry.execute_admin_result {
    // Anyone may execute once the delay has elapsed; no signature required.
    const cfg = this.loadConfig();
    System.require(!Util.isEmpty(cfg.pending_admin), "no pending admin transfer");
    const now = Util.now();
    System.require(now >= cfg.admin_transfer_effective_at, "admin transfer delay has not elapsed");

    const previous = cfg.admin!;
    const newAdmin = cfg.pending_admin!;
    cfg.admin = newAdmin;
    cfg.pending_admin = null;
    cfg.admin_transfer_effective_at = 0;
    this.config.put(cfg);

    const ev = new registry.admin_changed_event(previous, newAdmin, now);
    System.event(
      "osp.registry.admin_changed",
      Protobuf.encode(ev, registry.admin_changed_event.encode),
      [newAdmin, previous]
    );
    return new registry.execute_admin_result();
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  get_contract(
    args: registry.get_contract_arguments
  ): registry.get_contract_result {
    const res = new registry.get_contract_result();
    if (args.name == null || args.name!.length == 0) return res;
    res.value = this.active.get(this.nameKey(args.name!));
    return res;
  }

  get_proposed_contract(
    args: registry.get_proposed_contract_arguments
  ): registry.get_proposed_contract_result {
    const res = new registry.get_proposed_contract_result();
    if (args.name == null || args.name!.length == 0) return res;
    res.value = this.proposed.get(this.nameKey(args.name!));
    return res;
  }

  list_contracts(
    args: registry.list_contracts_arguments
  ): registry.list_contracts_result {
    // All active entries (including deprecated ones), at most 100, sorted by
    // raw name bytes. The chain's state store already iterates keys in that
    // order; the insertion sort makes the result order independent of the
    // backing store (the mock VM orders encoded keys differently).
    const objs = this.active.getMany(new Uint8Array(0), MAX_LIST_LIMIT, Storage.Direction.Ascending);
    const keys: Array<Uint8Array> = [];
    const values: Array<registry.contract_entry> = [];
    for (let i = 0; i < objs.length; i++) {
      const key = objs[i].key!;
      const value = objs[i].value;
      let j = keys.length;
      keys.push(key);
      values.push(value);
      while (j > 0 && Util.compare(keys[j - 1], key) > 0) {
        keys[j] = keys[j - 1];
        values[j] = values[j - 1];
        j--;
      }
      keys[j] = key;
      values[j] = value;
    }
    return new registry.list_contracts_result(values);
  }

  get_config(args: registry.get_config_arguments): registry.get_config_result {
    const res = new registry.get_config_result();
    res.value = this.config.get();
    return res;
  }
}
