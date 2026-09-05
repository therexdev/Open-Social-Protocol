// Unit tests for the registry contract (as-pect 8 + Koinos mock VM).
//
// Conventions: as-pect cannot reflect generated protobuf classes, so every
// assertion is on primitives; byte fields are compared with Arrays.equal.
// A revert rolls the mock database back to the last MockVM.commitTransaction(),
// so happy-path calls that later steps depend on are committed explicitly.
import { Arrays, Base58, MockVM, Protobuf, system_calls } from "@koinos/sdk-as";
import { Registry } from "../Registry";
import { registry } from "../proto/registry";
import { Testing } from "../common/testing";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTRACT_ID = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu");
const ADMIN = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe");
const NEW_ADMIN = Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH");
const IDENTITY_V1 = Base58.decode("161DDwJNQyHqYJbP4C7Y8BTULrkjgC4U6g");
const IDENTITY_V2 = Base58.decode("1GXe3r3VmkKAEhj6C156jPxQC8p1xbQD2i");
const RELATIONSHIPS_V1 = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK");
const STRANGER = syntheticAddress(0x55);
const OTHER = syntheticAddress(0x66);

const T0: u64 = Testing.DEFAULT_TIME;
const DAY: u64 = 86_400_000;
const DELAY: u64 = DAY;

const HASH1 = filled(32, 0xaa);
const HASH2 = filled(32, 0xbb);

const STATUS_PROPOSED: i32 = 0;
const STATUS_ACTIVE: i32 = 1;
const STATUS_DEPRECATED: i32 = 2;

let contract!: Registry;

function filled(n: i32, v: u8): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = v;
  return out;
}

/** A structurally valid 25-byte address (the contract only checks the length). */
function syntheticAddress(v: u8): Uint8Array {
  return filled(25, v);
}

function repeat(ch: string, n: i32): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ch;
  return s;
}

function pad3(i: i32): string {
  let s = i.toString();
  while (s.length < 3) s = "0" + s;
  return s;
}

function setup(): void {
  Testing.setup(CONTRACT_ID);
  // Testing.setup writes contract id / entry point / arguments after the mock
  // VM's reset commit; commit again so a revert cannot roll that metadata away.
  MockVM.commitTransaction();
  contract = new Registry();
}

function initRegistry(delay: u64 = DELAY): void {
  Testing.authorize([CONTRACT_ID]);
  contract.init(new registry.init_arguments(ADMIN, delay, 1));
  MockVM.commitTransaction();
}

function proposeAs(
  signer: Uint8Array,
  name: string | null,
  address: Uint8Array | null,
  version: u32,
  abiHash: Uint8Array | null,
  notes: string | null
): void {
  Testing.authorize([signer]);
  contract.propose_contract(new registry.propose_contract_arguments(name, address, version, abiHash, notes));
}

/** Admin proposal committed to the mock database. */
function propose(name: string, address: Uint8Array, version: u32, abiHash: Uint8Array | null = null, notes: string | null = null): void {
  proposeAs(ADMIN, name, address, version, abiHash, notes);
  MockVM.commitTransaction();
}

function apply(name: string): void {
  Testing.authorize([]);
  contract.apply_contract(new registry.apply_contract_arguments(name));
}

function cancelAs(signer: Uint8Array, name: string): void {
  Testing.authorize([signer]);
  contract.cancel_contract(new registry.cancel_contract_arguments(name));
}

function deprecateAs(signer: Uint8Array, name: string, notes: string | null): void {
  Testing.authorize([signer]);
  contract.deprecate_contract(new registry.deprecate_contract_arguments(name, notes));
}

function proposeAdminAs(signer: Uint8Array, newAdmin: Uint8Array | null): void {
  Testing.authorize([signer]);
  contract.propose_admin(new registry.propose_admin_arguments(newAdmin));
}

function cancelAdminAs(signer: Uint8Array): void {
  Testing.authorize([signer]);
  contract.cancel_admin(new registry.cancel_admin_arguments());
}

function executeAdmin(): void {
  Testing.authorize([]);
  contract.execute_admin(new registry.execute_admin_arguments());
}

function getContract(name: string | null): registry.contract_entry | null {
  return contract.get_contract(new registry.get_contract_arguments(name)).value;
}

function requireContract(name: string): registry.contract_entry {
  const entry = getContract(name);
  expect(entry == null).toBe(false, "active entry missing for " + name);
  return entry!;
}

function getProposed(name: string | null): registry.contract_entry | null {
  return contract.get_proposed_contract(new registry.get_proposed_contract_arguments(name)).value;
}

function requireProposed(name: string): registry.contract_entry {
  const entry = getProposed(name);
  expect(entry == null).toBe(false, "proposed entry missing for " + name);
  return entry!;
}

function getConfig(): registry.registry_config | null {
  return contract.get_config(new registry.get_config_arguments()).value;
}

function requireConfig(): registry.registry_config {
  const cfg = getConfig();
  expect(cfg == null).toBe(false, "config missing");
  return cfg!;
}

function listContracts(): Array<registry.contract_entry> {
  return contract.list_contracts(new registry.list_contracts_arguments()).values;
}

function lastEvent(): system_calls.event_arguments {
  const events = MockVM.getEvents();
  expect(events.length > 0).toBe(true, "no events emitted");
  return events[events.length - 1];
}

function eventCount(): i32 {
  return MockVM.getEvents().length;
}

function expectRevert(substr: string): void {
  const err = Testing.lastError();
  expect(err.includes(substr)).toBe(true, "expected revert containing '" + substr + "' but got '" + err + "'");
}

function expectImpacted(ev: system_calls.event_arguments, expected: Uint8Array[]): void {
  expect(ev.impacted.length).toBe(expected.length, "impacted length");
  for (let i = 0; i < expected.length; i++) {
    expect(Arrays.equal(ev.impacted[i], expected[i])).toBe(true, "impacted[" + i.toString() + "]");
  }
}

// ---------------------------------------------------------------------------
// init / get_config
// ---------------------------------------------------------------------------

describe("registry: init", () => {
  beforeEach(() => {
    setup();
  });

  it("get_config returns null before init", () => {
    expect(getConfig() == null).toBe(true);
  });

  it("initializes when signed by the contract account and stores the config", () => {
    Testing.authorize([CONTRACT_ID]);
    contract.init(new registry.init_arguments(ADMIN, DELAY, 1));

    const cfg = requireConfig();
    expect(Arrays.equal(cfg.admin!, ADMIN)).toBe(true);
    expect(cfg.upgrade_delay_ms).toBe(DELAY);
    expect(cfg.protocol_version).toBe(1);
    expect(cfg.pending_admin == null || cfg.pending_admin!.length == 0).toBe(true);
    expect(cfg.admin_transfer_effective_at).toBe(0);
    expect(eventCount()).toBe(0);
  });

  it("rejects a signer other than the contract account", () => {
    Testing.authorize([ADMIN]);
    expect(() => {
      contract.init(new registry.init_arguments(ADMIN, DELAY, 1));
    }).toThrow();
    expectRevert("authorization failed");
    expect(getConfig() == null).toBe(true);

    Testing.authorize([]);
    expect(() => {
      contract.init(new registry.init_arguments(ADMIN, DELAY, 1));
    }).toThrow();
    expectRevert("authorization failed");
  });

  it("may run only once", () => {
    initRegistry();
    Testing.authorize([CONTRACT_ID]);
    expect(() => {
      contract.init(new registry.init_arguments(NEW_ADMIN, DELAY, 2));
    }).toThrow();
    expectRevert("already initialized");
    const cfg = requireConfig();
    expect(Arrays.equal(cfg.admin!, ADMIN)).toBe(true);
    expect(cfg.protocol_version).toBe(1);
  });

  it("rejects a malformed admin address", () => {
    Testing.authorize([CONTRACT_ID]);
    expect(() => {
      contract.init(new registry.init_arguments(null, DELAY, 1));
    }).toThrow();
    expectRevert("admin is required");
    expect(() => {
      contract.init(new registry.init_arguments(filled(10, 1), DELAY, 1));
    }).toThrow();
    expectRevert("admin must be a 25-byte address");
  });

  it("caps upgrade_delay_ms at 30 days", () => {
    Testing.authorize([CONTRACT_ID]);
    expect(() => {
      contract.init(new registry.init_arguments(ADMIN, 30 * DAY + 1, 1));
    }).toThrow();
    expectRevert("upgrade_delay_ms too large");

    Testing.authorize([CONTRACT_ID]);
    contract.init(new registry.init_arguments(ADMIN, 30 * DAY, 1));
    expect(requireConfig().upgrade_delay_ms).toBe(30 * DAY);
  });

  it("accepts a zero upgrade delay", () => {
    Testing.authorize([CONTRACT_ID]);
    contract.init(new registry.init_arguments(ADMIN, 0, 1));
    expect(requireConfig().upgrade_delay_ms).toBe(0);
  });

  it("rejects protocol_version 0", () => {
    Testing.authorize([CONTRACT_ID]);
    expect(() => {
      contract.init(new registry.init_arguments(ADMIN, DELAY, 0));
    }).toThrow();
    expectRevert("protocol_version must be >= 1");
  });

  it("write methods revert with 'not initialized' before init", () => {
    Testing.authorize([ADMIN, CONTRACT_ID]);
    expect(() => {
      contract.propose_contract(new registry.propose_contract_arguments("identity", IDENTITY_V1, 1, null, null));
    }).toThrow();
    expectRevert("not initialized");
    expect(() => {
      contract.apply_contract(new registry.apply_contract_arguments("identity"));
    }).toThrow();
    expectRevert("not initialized");
    expect(() => {
      contract.cancel_contract(new registry.cancel_contract_arguments("identity"));
    }).toThrow();
    expectRevert("not initialized");
    expect(() => {
      contract.deprecate_contract(new registry.deprecate_contract_arguments("identity", null));
    }).toThrow();
    expectRevert("not initialized");
    expect(() => {
      contract.propose_admin(new registry.propose_admin_arguments(NEW_ADMIN));
    }).toThrow();
    expectRevert("not initialized");
    expect(() => {
      contract.cancel_admin(new registry.cancel_admin_arguments());
    }).toThrow();
    expectRevert("not initialized");
    expect(() => {
      contract.execute_admin(new registry.execute_admin_arguments());
    }).toThrow();
    expectRevert("not initialized");
  });
});

// ---------------------------------------------------------------------------
// propose_contract: bootstrap (no active entry yet)
// ---------------------------------------------------------------------------

describe("registry: propose_contract bootstrap", () => {
  beforeEach(() => {
    setup();
    initRegistry();
  });

  it("activates immediately and emits osp.registry.contract_activated", () => {
    Testing.setTime(T0 + 7);
    proposeAs(ADMIN, "identity", IDENTITY_V1, 1, HASH1, "initial deployment");

    const entry = requireContract("identity");
    expect(entry.name!).toBe("identity");
    expect(Arrays.equal(entry.address!, IDENTITY_V1)).toBe(true);
    expect(entry.version).toBe(1);
    expect(Arrays.equal(entry.abi_hash!, HASH1)).toBe(true);
    expect(<i32>entry.status).toBe(STATUS_ACTIVE);
    expect(entry.effective_at).toBe(T0 + 7);
    expect(entry.notes!).toBe("initial deployment");
    expect(entry.updated_at).toBe(T0 + 7);
    expect(getProposed("identity") == null).toBe(true);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.registry.contract_activated");
    expectImpacted(ev, [IDENTITY_V1, ADMIN]);
    const data = Protobuf.decode<registry.contract_activated_event>(ev.data, registry.contract_activated_event.decode);
    expect(data.name!).toBe("identity");
    expect(Arrays.equal(data.address!, IDENTITY_V1)).toBe(true);
    expect(data.version).toBe(1);
    expect(data.timestamp).toBe(T0 + 7);
  });

  it("stores an empty abi_hash and empty notes as unset", () => {
    proposeAs(ADMIN, "identity", IDENTITY_V1, 1, new Uint8Array(0), "");
    const entry = requireContract("identity");
    expect(entry.abi_hash == null).toBe(true);
    expect(entry.notes == null).toBe(true);
  });

  it("does not require version 1 for the first entry", () => {
    proposeAs(ADMIN, "identity", IDENTITY_V1, 7, null, null);
    expect(requireContract("identity").version).toBe(7);
  });

  it("bootstraps independent names independently", () => {
    propose("identity", IDENTITY_V1, 1);
    propose("relationships", RELATIONSHIPS_V1, 1);
    expect(Arrays.equal(requireContract("identity").address!, IDENTITY_V1)).toBe(true);
    expect(Arrays.equal(requireContract("relationships").address!, RELATIONSHIPS_V1)).toBe(true);
    expect(getProposed("identity") == null).toBe(true);
    expect(getProposed("relationships") == null).toBe(true);
    expect(eventCount()).toBe(2);
  });

  it("validates the name", () => {
    expect(() => {
      proposeAs(ADMIN, null, IDENTITY_V1, 1, null, null);
    }).toThrow();
    expectRevert("name is required");
    expect(() => {
      proposeAs(ADMIN, "", IDENTITY_V1, 1, null, null);
    }).toThrow();
    expectRevert("name is required");
    expect(() => {
      proposeAs(ADMIN, repeat("a", 33), IDENTITY_V1, 1, null, null);
    }).toThrow();
    expectRevert("name too long");
    expect(() => {
      proposeAs(ADMIN, "Identity", IDENTITY_V1, 1, null, null);
    }).toThrow();
    expectRevert("name must match [a-z0-9_-]");
    expect(() => {
      proposeAs(ADMIN, "iden tity", IDENTITY_V1, 1, null, null);
    }).toThrow();
    expectRevert("name must match [a-z0-9_-]");
    expect(() => {
      proposeAs(ADMIN, "identity.v1", IDENTITY_V1, 1, null, null);
    }).toThrow();
    expectRevert("name must match [a-z0-9_-]");
    expect(listContracts().length).toBe(0);

    // Boundary: 32 chars of the allowed alphabet.
    const longName = repeat("a", 28) + "-_09";
    proposeAs(ADMIN, longName, IDENTITY_V1, 1, null, null);
    expect(requireContract(longName).name!).toBe(longName);
  });

  it("validates the address", () => {
    expect(() => {
      proposeAs(ADMIN, "identity", null, 1, null, null);
    }).toThrow();
    expectRevert("address is required");
    expect(() => {
      proposeAs(ADMIN, "identity", filled(24, 1), 1, null, null);
    }).toThrow();
    expectRevert("address must be a 25-byte address");
  });

  it("rejects version 0", () => {
    expect(() => {
      proposeAs(ADMIN, "identity", IDENTITY_V1, 0, null, null);
    }).toThrow();
    expectRevert("version must be >= 1");
  });

  it("rejects an abi_hash that is not empty or 32 bytes", () => {
    expect(() => {
      proposeAs(ADMIN, "identity", IDENTITY_V1, 1, filled(31, 1), null);
    }).toThrow();
    expectRevert("abi_hash must be empty or 32 bytes");
    expect(() => {
      proposeAs(ADMIN, "identity", IDENTITY_V1, 1, filled(33, 1), null);
    }).toThrow();
    expectRevert("abi_hash must be empty or 32 bytes");
  });

  it("caps notes at 256 characters", () => {
    expect(() => {
      proposeAs(ADMIN, "identity", IDENTITY_V1, 1, null, repeat("n", 257));
    }).toThrow();
    expectRevert("notes too long");
    proposeAs(ADMIN, "identity", IDENTITY_V1, 1, null, repeat("n", 256));
    expect(requireContract("identity").notes!.length).toBe(256);
  });

  it("rejects a signer other than the admin", () => {
    expect(() => {
      proposeAs(STRANGER, "identity", IDENTITY_V1, 1, null, null);
    }).toThrow();
    expectRevert("authorization failed");
    // The contract account itself is not the admin either.
    expect(() => {
      proposeAs(CONTRACT_ID, "identity", IDENTITY_V1, 1, null, null);
    }).toThrow();
    expectRevert("authorization failed");
    Testing.authorize([]);
    expect(() => {
      contract.propose_contract(new registry.propose_contract_arguments("identity", IDENTITY_V1, 1, null, null));
    }).toThrow();
    expectRevert("authorization failed");
    expect(getContract("identity") == null).toBe(true);
    expect(eventCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// propose_contract: upgrade (time-locked proposal)
// ---------------------------------------------------------------------------

describe("registry: propose_contract upgrade", () => {
  beforeEach(() => {
    setup();
    initRegistry();
    propose("identity", IDENTITY_V1, 1, HASH1, "v1");
  });

  it("stores a proposal with effective_at = now + delay and emits osp.registry.contract_proposed", () => {
    Testing.setTime(T0 + 5);
    proposeAs(ADMIN, "identity", IDENTITY_V2, 2, HASH2, "v2 notes");

    const pending = requireProposed("identity");
    expect(pending.name!).toBe("identity");
    expect(Arrays.equal(pending.address!, IDENTITY_V2)).toBe(true);
    expect(pending.version).toBe(2);
    expect(Arrays.equal(pending.abi_hash!, HASH2)).toBe(true);
    expect(<i32>pending.status).toBe(STATUS_PROPOSED);
    expect(pending.effective_at).toBe(T0 + 5 + DELAY);
    expect(pending.notes!).toBe("v2 notes");
    expect(pending.updated_at).toBe(T0 + 5);

    // The active entry is untouched until apply_contract.
    const active = requireContract("identity");
    expect(Arrays.equal(active.address!, IDENTITY_V1)).toBe(true);
    expect(active.version).toBe(1);
    expect(<i32>active.status).toBe(STATUS_ACTIVE);
    expect(active.updated_at).toBe(T0);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.registry.contract_proposed");
    expectImpacted(ev, [IDENTITY_V2, ADMIN]);
    const data = Protobuf.decode<registry.contract_proposed_event>(ev.data, registry.contract_proposed_event.decode);
    expect(data.name!).toBe("identity");
    expect(Arrays.equal(data.address!, IDENTITY_V2)).toBe(true);
    expect(data.version).toBe(2);
    expect(Arrays.equal(data.abi_hash!, HASH2)).toBe(true);
    expect(data.effective_at).toBe(T0 + 5 + DELAY);
  });

  it("requires a version strictly greater than the active version", () => {
    expect(() => {
      proposeAs(ADMIN, "identity", IDENTITY_V2, 1, null, null);
    }).toThrow();
    expectRevert("version must be greater than the active version");
    expect(getProposed("identity") == null).toBe(true);

    propose("relationships", RELATIONSHIPS_V1, 3);
    expect(() => {
      proposeAs(ADMIN, "relationships", OTHER, 2, null, null);
    }).toThrow();
    expectRevert("version must be greater than the active version");
    expect(getProposed("relationships") == null).toBe(true);

    // Gaps are allowed.
    proposeAs(ADMIN, "relationships", OTHER, 10, null, null);
    expect(requireProposed("relationships").version).toBe(10);
  });

  it("allows re-registering the same address under a higher version", () => {
    proposeAs(ADMIN, "identity", IDENTITY_V1, 2, HASH2, null);
    const pending = requireProposed("identity");
    expect(Arrays.equal(pending.address!, IDENTITY_V1)).toBe(true);
    expect(pending.version).toBe(2);
  });

  it("a newer proposal replaces the pending one and restarts the delay", () => {
    propose("identity", IDENTITY_V2, 2);
    Testing.setTime(T0 + 10);
    proposeAs(ADMIN, "identity", OTHER, 3, null, null);

    const pending = requireProposed("identity");
    expect(Arrays.equal(pending.address!, OTHER)).toBe(true);
    expect(pending.version).toBe(3);
    expect(pending.effective_at).toBe(T0 + 10 + DELAY);
    expect(pending.updated_at).toBe(T0 + 10);
    expect(requireContract("identity").version).toBe(1);
  });

  it("still accepts a lower version than a pending proposal (only the active version counts)", () => {
    propose("identity", OTHER, 5);
    proposeAs(ADMIN, "identity", IDENTITY_V2, 2, null, null);
    expect(requireProposed("identity").version).toBe(2);
  });

  it("can propose an upgrade for a deprecated entry", () => {
    deprecateAs(ADMIN, "identity", "sunset");
    MockVM.commitTransaction();
    proposeAs(ADMIN, "identity", IDENTITY_V2, 2, null, null);
    expect(requireProposed("identity").version).toBe(2);
    expect(<i32>requireContract("identity").status).toBe(STATUS_DEPRECATED);
  });

  it("rejects a signer other than the admin", () => {
    expect(() => {
      proposeAs(STRANGER, "identity", IDENTITY_V2, 2, null, null);
    }).toThrow();
    expectRevert("authorization failed");
    expect(getProposed("identity") == null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// apply_contract
// ---------------------------------------------------------------------------

describe("registry: apply_contract", () => {
  beforeEach(() => {
    setup();
    initRegistry();
    propose("identity", IDENTITY_V1, 1, HASH1, "v1");
    propose("identity", IDENTITY_V2, 2, HASH2, "v2");
  });

  it("reverts before the delay has elapsed", () => {
    expect(() => {
      apply("identity");
    }).toThrow();
    expectRevert("upgrade delay has not elapsed");

    Testing.setTime(T0 + DELAY - 1);
    expect(() => {
      apply("identity");
    }).toThrow();
    expectRevert("upgrade delay has not elapsed");

    expect(requireContract("identity").version).toBe(1);
    expect(requireProposed("identity").version).toBe(2);
  });

  it("anyone can apply at effective_at; the entry moves to active and emits contract_activated", () => {
    Testing.setTime(T0 + DELAY);
    apply("identity");

    const active = requireContract("identity");
    expect(Arrays.equal(active.address!, IDENTITY_V2)).toBe(true);
    expect(active.version).toBe(2);
    expect(Arrays.equal(active.abi_hash!, HASH2)).toBe(true);
    expect(<i32>active.status).toBe(STATUS_ACTIVE);
    expect(active.effective_at).toBe(T0 + DELAY);
    expect(active.notes!).toBe("v2");
    expect(active.updated_at).toBe(T0 + DELAY);
    expect(getProposed("identity") == null).toBe(true);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.registry.contract_activated");
    expectImpacted(ev, [IDENTITY_V2]);
    const data = Protobuf.decode<registry.contract_activated_event>(ev.data, registry.contract_activated_event.decode);
    expect(data.name!).toBe("identity");
    expect(Arrays.equal(data.address!, IDENTITY_V2)).toBe(true);
    expect(data.version).toBe(2);
    expect(data.timestamp).toBe(T0 + DELAY);
  });

  it("applies late (well after effective_at) with updated_at = now", () => {
    Testing.setTime(T0 + 5 * DELAY);
    Testing.authorize([STRANGER]);
    contract.apply_contract(new registry.apply_contract_arguments("identity"));
    const active = requireContract("identity");
    expect(active.version).toBe(2);
    expect(active.effective_at).toBe(T0 + DELAY);
    expect(active.updated_at).toBe(T0 + 5 * DELAY);
  });

  it("reverts when nothing is proposed for the name", () => {
    Testing.setTime(T0 + DELAY);
    expect(() => {
      apply("relationships");
    }).toThrow();
    expectRevert("no proposed entry for name");

    apply("identity");
    MockVM.commitTransaction();
    expect(() => {
      apply("identity");
    }).toThrow();
    expectRevert("no proposed entry for name");
  });

  it("validates the name", () => {
    expect(() => {
      apply("");
    }).toThrow();
    expectRevert("name is required");
    expect(() => {
      apply("Identity");
    }).toThrow();
    expectRevert("name must match [a-z0-9_-]");
  });

  it("after applying, the next proposal must exceed the new active version", () => {
    Testing.setTime(T0 + DELAY);
    apply("identity");
    MockVM.commitTransaction();
    expect(() => {
      proposeAs(ADMIN, "identity", OTHER, 2, null, null);
    }).toThrow();
    expectRevert("version must be greater than the active version");
    proposeAs(ADMIN, "identity", OTHER, 3, null, null);
    expect(requireProposed("identity").effective_at).toBe(T0 + 2 * DELAY);
  });
});

describe("registry: apply_contract with a zero delay", () => {
  beforeEach(() => {
    setup();
    initRegistry(0);
    propose("identity", IDENTITY_V1, 1);
  });

  it("proposals can be applied in the same block", () => {
    propose("identity", IDENTITY_V2, 2);
    expect(requireProposed("identity").effective_at).toBe(T0);
    apply("identity");
    expect(requireContract("identity").version).toBe(2);
    expect(getProposed("identity") == null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cancel_contract
// ---------------------------------------------------------------------------

describe("registry: cancel_contract", () => {
  beforeEach(() => {
    setup();
    initRegistry();
    propose("identity", IDENTITY_V1, 1);
    propose("identity", IDENTITY_V2, 2);
  });

  it("admin cancels a pending proposal and emits osp.registry.contract_cancelled", () => {
    Testing.setTime(T0 + 3);
    cancelAs(ADMIN, "identity");

    expect(getProposed("identity") == null).toBe(true);
    const active = requireContract("identity");
    expect(active.version).toBe(1);
    expect(<i32>active.status).toBe(STATUS_ACTIVE);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.registry.contract_cancelled");
    expectImpacted(ev, [IDENTITY_V2, ADMIN]);
    const data = Protobuf.decode<registry.contract_cancelled_event>(ev.data, registry.contract_cancelled_event.decode);
    expect(data.name!).toBe("identity");
    expect(data.timestamp).toBe(T0 + 3);
  });

  it("a cancelled proposal can no longer be applied", () => {
    cancelAs(ADMIN, "identity");
    MockVM.commitTransaction();
    Testing.setTime(T0 + DELAY);
    expect(() => {
      apply("identity");
    }).toThrow();
    expectRevert("no proposed entry for name");
  });

  it("reverts when nothing is proposed for the name", () => {
    expect(() => {
      cancelAs(ADMIN, "relationships");
    }).toThrow();
    expectRevert("no proposed entry for name");
  });

  it("rejects a signer other than the admin", () => {
    expect(() => {
      cancelAs(STRANGER, "identity");
    }).toThrow();
    expectRevert("authorization failed");
    expect(requireProposed("identity").version).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// deprecate_contract
// ---------------------------------------------------------------------------

describe("registry: deprecate_contract", () => {
  beforeEach(() => {
    setup();
    initRegistry();
    propose("identity", IDENTITY_V1, 1, HASH1, "v1");
  });

  it("admin deprecates an active entry and emits osp.registry.contract_deprecated", () => {
    Testing.setTime(T0 + 9);
    deprecateAs(ADMIN, "identity", "use identity v2");

    const entry = requireContract("identity");
    expect(<i32>entry.status).toBe(STATUS_DEPRECATED);
    expect(entry.notes!).toBe("use identity v2");
    expect(entry.updated_at).toBe(T0 + 9);
    expect(entry.effective_at).toBe(T0);
    expect(Arrays.equal(entry.address!, IDENTITY_V1)).toBe(true);
    expect(entry.version).toBe(1);
    expect(Arrays.equal(entry.abi_hash!, HASH1)).toBe(true);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.registry.contract_deprecated");
    expectImpacted(ev, [IDENTITY_V1, ADMIN]);
    const data = Protobuf.decode<registry.contract_deprecated_event>(ev.data, registry.contract_deprecated_event.decode);
    expect(data.name!).toBe("identity");
    expect(Arrays.equal(data.address!, IDENTITY_V1)).toBe(true);
    expect(data.version).toBe(1);
    expect(data.timestamp).toBe(T0 + 9);

    // Deprecated entries stay listed (deprecation is a signal, not a removal).
    const listed = listContracts();
    expect(listed.length).toBe(1);
    expect(<i32>listed[0].status).toBe(STATUS_DEPRECATED);
  });

  it("clears the notes when none are given", () => {
    deprecateAs(ADMIN, "identity", null);
    expect(requireContract("identity").notes == null).toBe(true);
  });

  it("rejects deprecating twice", () => {
    deprecateAs(ADMIN, "identity", "first");
    MockVM.commitTransaction();
    expect(() => {
      deprecateAs(ADMIN, "identity", "second");
    }).toThrow();
    expectRevert("contract already deprecated");
    expect(requireContract("identity").notes!).toBe("first");
  });

  it("reverts when no active entry exists for the name", () => {
    expect(() => {
      deprecateAs(ADMIN, "relationships", null);
    }).toThrow();
    expectRevert("no active entry for name");
  });

  it("caps notes at 256 characters", () => {
    expect(() => {
      deprecateAs(ADMIN, "identity", repeat("n", 257));
    }).toThrow();
    expectRevert("notes too long");
    expect(<i32>requireContract("identity").status).toBe(STATUS_ACTIVE);
  });

  it("rejects a signer other than the admin", () => {
    expect(() => {
      deprecateAs(STRANGER, "identity", null);
    }).toThrow();
    expectRevert("authorization failed");
    expect(<i32>requireContract("identity").status).toBe(STATUS_ACTIVE);
  });

  it("an applied upgrade replaces a deprecated entry with an active one", () => {
    deprecateAs(ADMIN, "identity", "sunset");
    MockVM.commitTransaction();
    propose("identity", IDENTITY_V2, 2, HASH2, "v2");
    Testing.setTime(T0 + DELAY);
    apply("identity");
    const entry = requireContract("identity");
    expect(<i32>entry.status).toBe(STATUS_ACTIVE);
    expect(entry.version).toBe(2);
    expect(entry.notes!).toBe("v2");
  });
});

// ---------------------------------------------------------------------------
// Admin transfer: propose_admin / cancel_admin / execute_admin
// ---------------------------------------------------------------------------

describe("registry: admin transfer", () => {
  beforeEach(() => {
    setup();
    initRegistry();
  });

  it("propose_admin stores the pending admin and emits osp.registry.admin_proposed", () => {
    Testing.setTime(T0 + 11);
    proposeAdminAs(ADMIN, NEW_ADMIN);

    const cfg = requireConfig();
    expect(Arrays.equal(cfg.admin!, ADMIN)).toBe(true);
    expect(Arrays.equal(cfg.pending_admin!, NEW_ADMIN)).toBe(true);
    expect(cfg.admin_transfer_effective_at).toBe(T0 + 11 + DELAY);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.registry.admin_proposed");
    expectImpacted(ev, [NEW_ADMIN, ADMIN]);
    const data = Protobuf.decode<registry.admin_proposed_event>(ev.data, registry.admin_proposed_event.decode);
    expect(Arrays.equal(data.new_admin!, NEW_ADMIN)).toBe(true);
    expect(data.effective_at).toBe(T0 + 11 + DELAY);
  });

  it("propose_admin rejects the current admin and malformed addresses", () => {
    expect(() => {
      proposeAdminAs(ADMIN, ADMIN);
    }).toThrow();
    expectRevert("new_admin must differ from the current admin");
    expect(() => {
      proposeAdminAs(ADMIN, null);
    }).toThrow();
    expectRevert("new_admin is required");
    expect(() => {
      proposeAdminAs(ADMIN, filled(3, 9));
    }).toThrow();
    expectRevert("new_admin must be a 25-byte address");
    const cfg = requireConfig();
    expect(cfg.pending_admin == null || cfg.pending_admin!.length == 0).toBe(true);
  });

  it("propose_admin rejects a signer other than the admin", () => {
    expect(() => {
      proposeAdminAs(NEW_ADMIN, NEW_ADMIN);
    }).toThrow();
    expectRevert("authorization failed");
    expect(() => {
      proposeAdminAs(CONTRACT_ID, NEW_ADMIN);
    }).toThrow();
    expectRevert("authorization failed");
  });

  it("a newer proposal replaces the pending admin and restarts the delay", () => {
    proposeAdminAs(ADMIN, NEW_ADMIN);
    MockVM.commitTransaction();
    Testing.setTime(T0 + 20);
    proposeAdminAs(ADMIN, STRANGER);
    const cfg = requireConfig();
    expect(Arrays.equal(cfg.pending_admin!, STRANGER)).toBe(true);
    expect(cfg.admin_transfer_effective_at).toBe(T0 + 20 + DELAY);
  });

  it("cancel_admin clears the pending transfer without an event", () => {
    proposeAdminAs(ADMIN, NEW_ADMIN);
    MockVM.commitTransaction();
    const before = eventCount();
    cancelAdminAs(ADMIN);
    const cfg = requireConfig();
    expect(Arrays.equal(cfg.admin!, ADMIN)).toBe(true);
    expect(cfg.pending_admin == null || cfg.pending_admin!.length == 0).toBe(true);
    expect(cfg.admin_transfer_effective_at).toBe(0);
    expect(eventCount()).toBe(before);

    MockVM.commitTransaction();
    Testing.setTime(T0 + DELAY);
    expect(() => {
      executeAdmin();
    }).toThrow();
    expectRevert("no pending admin transfer");
  });

  it("cancel_admin reverts when nothing is pending and for non-admin signers", () => {
    expect(() => {
      cancelAdminAs(ADMIN);
    }).toThrow();
    expectRevert("no pending admin transfer");

    proposeAdminAs(ADMIN, NEW_ADMIN);
    MockVM.commitTransaction();
    expect(() => {
      cancelAdminAs(NEW_ADMIN);
    }).toThrow();
    expectRevert("authorization failed");
    expect(Arrays.equal(requireConfig().pending_admin!, NEW_ADMIN)).toBe(true);
  });

  it("execute_admin reverts before the delay has elapsed", () => {
    proposeAdminAs(ADMIN, NEW_ADMIN);
    MockVM.commitTransaction();
    expect(() => {
      executeAdmin();
    }).toThrow();
    expectRevert("admin transfer delay has not elapsed");
    Testing.setTime(T0 + DELAY - 1);
    expect(() => {
      executeAdmin();
    }).toThrow();
    expectRevert("admin transfer delay has not elapsed");
    expect(Arrays.equal(requireConfig().admin!, ADMIN)).toBe(true);
  });

  it("execute_admin reverts when nothing is pending", () => {
    expect(() => {
      executeAdmin();
    }).toThrow();
    expectRevert("no pending admin transfer");
  });

  it("anyone can execute at effective_at; the admin changes and osp.registry.admin_changed is emitted", () => {
    proposeAdminAs(ADMIN, NEW_ADMIN);
    MockVM.commitTransaction();
    Testing.setTime(T0 + DELAY);
    Testing.authorize([STRANGER]);
    contract.execute_admin(new registry.execute_admin_arguments());

    const cfg = requireConfig();
    expect(Arrays.equal(cfg.admin!, NEW_ADMIN)).toBe(true);
    expect(cfg.pending_admin == null || cfg.pending_admin!.length == 0).toBe(true);
    expect(cfg.admin_transfer_effective_at).toBe(0);
    expect(cfg.upgrade_delay_ms).toBe(DELAY);
    expect(cfg.protocol_version).toBe(1);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.registry.admin_changed");
    expectImpacted(ev, [NEW_ADMIN, ADMIN]);
    const data = Protobuf.decode<registry.admin_changed_event>(ev.data, registry.admin_changed_event.decode);
    expect(Arrays.equal(data.previous_admin!, ADMIN)).toBe(true);
    expect(Arrays.equal(data.new_admin!, NEW_ADMIN)).toBe(true);
    expect(data.timestamp).toBe(T0 + DELAY);
  });

  it("after the transfer only the new admin may act, and it may transfer back", () => {
    proposeAdminAs(ADMIN, NEW_ADMIN);
    MockVM.commitTransaction();
    Testing.setTime(T0 + DELAY);
    executeAdmin();
    MockVM.commitTransaction();

    expect(() => {
      proposeAs(ADMIN, "identity", IDENTITY_V1, 1, null, null);
    }).toThrow();
    expectRevert("authorization failed");
    expect(() => {
      proposeAdminAs(ADMIN, STRANGER);
    }).toThrow();
    expectRevert("authorization failed");

    proposeAs(NEW_ADMIN, "identity", IDENTITY_V1, 1, null, null);
    MockVM.commitTransaction();
    expect(Arrays.equal(requireContract("identity").address!, IDENTITY_V1)).toBe(true);

    proposeAdminAs(NEW_ADMIN, ADMIN);
    MockVM.commitTransaction();
    Testing.setTime(T0 + 2 * DELAY);
    executeAdmin();
    expect(Arrays.equal(requireConfig().admin!, ADMIN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reads: get_contract / get_proposed_contract / list_contracts
// ---------------------------------------------------------------------------

describe("registry: reads", () => {
  beforeEach(() => {
    setup();
  });

  it("list_contracts is empty before init and before any proposal", () => {
    expect(listContracts().length).toBe(0);
    initRegistry();
    expect(listContracts().length).toBe(0);
  });

  it("get_contract and get_proposed_contract return null for unknown or empty names", () => {
    initRegistry();
    propose("identity", IDENTITY_V1, 1);
    expect(getContract("relationships") == null).toBe(true);
    expect(getContract("") == null).toBe(true);
    expect(getContract(null) == null).toBe(true);
    expect(getContract("Identity") == null).toBe(true);
    expect(getProposed("identity") == null).toBe(true);
    expect(getProposed("") == null).toBe(true);
    expect(getProposed(null) == null).toBe(true);
  });

  it("list_contracts returns active entries in name order and excludes pending proposals", () => {
    initRegistry();
    propose("relationships", RELATIONSHIPS_V1, 1);
    propose("identity", IDENTITY_V1, 1);
    propose("publications", OTHER, 2);
    propose("communities", STRANGER, 1);
    propose("identity", IDENTITY_V2, 2); // pending upgrade, not listed

    const listed = listContracts();
    expect(listed.length).toBe(4);
    expect(listed[0].name!).toBe("communities");
    expect(listed[1].name!).toBe("identity");
    expect(listed[2].name!).toBe("publications");
    expect(listed[3].name!).toBe("relationships");
    expect(listed[1].version).toBe(1);
    expect(Arrays.equal(listed[1].address!, IDENTITY_V1)).toBe(true);
    expect(listed[2].version).toBe(2);
    for (let i = 0; i < listed.length; i++) {
      expect(<i32>listed[i].status).toBe(STATUS_ACTIVE);
    }
  });

  it("list_contracts orders by raw name bytes ('-' and digits sort before letters)", () => {
    initRegistry();
    propose("b", OTHER, 1);
    propose("a-2", OTHER, 1);
    propose("a", OTHER, 1);
    propose("a1", OTHER, 1);
    propose("_z", OTHER, 1);
    const listed = listContracts();
    expect(listed.length).toBe(5);
    expect(listed[0].name!).toBe("_z");
    expect(listed[1].name!).toBe("a");
    expect(listed[2].name!).toBe("a-2");
    expect(listed[3].name!).toBe("a1");
    expect(listed[4].name!).toBe("b");
  });

  it("list_contracts returns at most 100 entries", () => {
    initRegistry();
    for (let i = 0; i < 105; i++) {
      propose("c" + pad3(i), OTHER, 1);
    }
    const listed = listContracts();
    expect(listed.length).toBe(100);
    expect(listed[0].name!).toBe("c000");
    expect(listed[99].name!).toBe("c099");
    expect(getContract("c104") == null).toBe(false);
  });
});
