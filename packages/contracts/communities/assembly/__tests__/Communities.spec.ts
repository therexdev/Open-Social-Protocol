// Unit tests for the communities contract (as-pect 8 + Koinos mock VM).
//
// Conventions: as-pect cannot reflect generated protobuf classes, so every
// assertion is on primitives; byte fields are compared with Arrays.equal.
// A revert rolls the mock database back to the last MockVM.commitTransaction(),
// so happy-path fixtures (and head-time changes) are committed explicitly.
//
// The identity contract is stubbed: every System.call to identity.resolve_actor
// consumes one queued result (Testing.mockResolveActor). Every mutating method
// of this contract makes exactly one such call, except execute_owner_transfer
// which is permissionless and makes none.
import { Arrays, Base58, MockVM, Protobuf, system_calls } from "@koinos/sdk-as";
import { Communities } from "../Communities";
import { communities } from "../proto/communities";
import { identity } from "../proto/identity";
import { Testing } from "../common/testing";
import { Util } from "../common/util";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTRACT_ID = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu");
const IDENTITY_CONTRACT = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK");
const ALICE = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe"); // community owner
const BOB = Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH"); // admin in most tests
const CAROL = Base58.decode("161DDwJNQyHqYJbP4C7Y8BTULrkjgC4U6g"); // moderator / member
const DEVICE = Base58.decode("1GXe3r3VmkKAEhj6C156jPxQC8p1xbQD2i");
// Extra accounts only need to be 25 bytes long (the contract never decodes them).
const DAVE = filled(25, 0x44);
const ERIN = filled(25, 0x45);

const T0: u64 = Testing.DEFAULT_TIME;
const HOUR: u64 = 3_600_000;
const DAY: u64 = 86_400_000;
const THIRTY_DAYS: u64 = 30 * DAY;
const DELAY: u64 = DAY;

const RESOLVE_ACTOR_ENTRY_POINT: u32 = 0x9f7b95a1;
const COMMUNITY_CAPABILITY: u32 = 16;

const NONE = communities.community_role.none;
const GUEST = communities.community_role.guest;
const MEMBER = communities.community_role.member;
const MODERATOR = communities.community_role.moderator;
const ADMIN = communities.community_role.admin;
const OWNER = communities.community_role.owner;
const BANNED = communities.community_role.banned;

const COMMUNITY_ID = filled(32, 0xc1);
const SECOND_ID = Util.str("second");
const SHORT_ID = Util.str("osp");
const POLICY_HASH = filled(32, 0xab);
const OTHER_HASH = filled(32, 0xcd);
const POLICY_URI = "ipfs://policy-v1";
const SCOPE = Util.str("topic:general");
const POST_ID = filled(32, 0x99);
const NAME = "Open Social";
const LONG_NAME = "n".repeat(65);
const MAX_NAME = "n".repeat(64);
const LONG_URI = "u".repeat(257);
const MAX_URI = "u".repeat(256);
const LONG_LABEL = "l".repeat(65);
const MAX_LABEL = "l".repeat(64);
const LONG_REASON = "r".repeat(257);

let contract!: Communities;

function filled(n: i32, v: u8): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = v;
  return out;
}

// ---------------------------------------------------------------------------
// Mock VM helpers
// ---------------------------------------------------------------------------

function setup(): void {
  Testing.setup(CONTRACT_ID);
  // Testing.setup writes contract id / entry point / arguments after the mock
  // VM's reset commit; commit again so a revert cannot roll that metadata away.
  MockVM.commitTransaction();
  contract = new Communities();
}

function configureIdentity(): void {
  Testing.authorize([CONTRACT_ID]);
  contract.set_identity_contract(new communities.set_identity_contract_arguments(IDENTITY_CONTRACT));
  MockVM.commitTransaction();
}

function setupConfigured(): void {
  setup();
  configureIdentity();
}

/** Sign as `account` and resolve the next identity lookup to that same account (owner path). */
function asOwner(account: Uint8Array): void {
  Testing.authorize([account]);
  Testing.mockResolveActor(true, account, "", 1);
}

/** Sign as `device` and resolve the next identity lookup to that device key. */
function asDevice(device: Uint8Array): void {
  Testing.authorize([device]);
  Testing.mockResolveActor(true, device, "", 1);
}

/** Move the head block time and commit so a later revert keeps it. */
function advanceTo(time: u64): void {
  Testing.setTime(time);
  MockVM.commitTransaction();
}

function lastEvent(): system_calls.event_arguments {
  const events = MockVM.getEvents();
  expect(events.length > 0).toBe(true, "no events emitted");
  return events[events.length - 1];
}

function eventCount(): i32 {
  return MockVM.getEvents().length;
}

/**
 * Drop events emitted by fixtures. The mock VM returns the whole event list
 * through a 1 KiB system-call buffer, so tests clear it before the action
 * whose events they assert on.
 */
function clearEvents(): void {
  MockVM.clearEvents();
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

function callCount(): i32 {
  return MockVM.getCallContractArguments().length;
}

/**
 * Decode the resolve_actor arguments of the most recent cross-contract call.
 * Cross-contract call arguments accumulate across fixtures (they are not
 * cleared with the events), so assertions always look at the last one.
 */
function lastResolveCall(): identity.resolve_actor_arguments {
  const calls = MockVM.getCallContractArguments();
  expect(calls.length > 0).toBe(true, "no cross-contract call made");
  const call = calls[calls.length - 1];
  expect(Arrays.equal(call.contract_id, IDENTITY_CONTRACT)).toBe(true, "call targets identity contract");
  expect(call.entry_point).toBe(RESOLVE_ACTOR_ENTRY_POINT, "call entry point");
  return Protobuf.decode<identity.resolve_actor_arguments>(call.args, identity.resolve_actor_arguments.decode);
}

function expectOwnerResolution(account: Uint8Array): void {
  const call = lastResolveCall();
  expect(Arrays.equal(call.account!, account)).toBe(true, "resolved account");
  expect(call.device == null || call.device!.length == 0).toBe(true, "device must be empty");
  expect(call.capability).toBe(0, "capability must be 0");
}

function expectDeviceResolution(account: Uint8Array, device: Uint8Array): void {
  const call = lastResolveCall();
  expect(Arrays.equal(call.account!, account)).toBe(true, "resolved account");
  expect(call.device == null).toBe(false, "device must be forwarded");
  expect(Arrays.equal(call.device!, device)).toBe(true, "resolved device");
  expect(call.capability).toBe(COMMUNITY_CAPABILITY, "capability must be COMMUNITY");
}

// ---------------------------------------------------------------------------
// Contract call wrappers (module-level so they can be used inside closures)
// ---------------------------------------------------------------------------

function createCommunity(
  creator: Uint8Array | null,
  id: Uint8Array | null,
  name: string | null,
  policyHash: Uint8Array | null = null,
  policyUri: string | null = null,
  delay: u64 = DELAY,
  device: Uint8Array | null = null
): void {
  contract.create_community(
    new communities.create_community_arguments(creator, id, name, policyHash, policyUri, delay, device)
  );
}

function setRole(
  communityId: Uint8Array | null,
  actor: Uint8Array | null,
  subject: Uint8Array | null,
  role: communities.community_role,
  scope: Uint8Array | null = null,
  expiresAt: u64 = 0,
  device: Uint8Array | null = null
): void {
  contract.set_role(new communities.set_role_arguments(communityId, actor, subject, role, scope, expiresAt, device));
}

function setPolicy(
  communityId: Uint8Array | null,
  actor: Uint8Array | null,
  policyHash: Uint8Array | null,
  policyUri: string | null,
  device: Uint8Array | null = null
): void {
  contract.set_policy(new communities.set_policy_arguments(communityId, actor, policyHash, policyUri, device));
}

function propose(communityId: Uint8Array | null, owner: Uint8Array | null, newOwner: Uint8Array | null): void {
  contract.propose_owner_transfer(new communities.propose_owner_transfer_arguments(communityId, owner, newOwner));
}

function cancel(communityId: Uint8Array | null, owner: Uint8Array | null): void {
  contract.cancel_owner_transfer(new communities.cancel_owner_transfer_arguments(communityId, owner));
}

function execute(communityId: Uint8Array | null): void {
  contract.execute_owner_transfer(new communities.execute_owner_transfer_arguments(communityId));
}

function setLabel(
  communityId: Uint8Array | null,
  actor: Uint8Array | null,
  postId: Uint8Array | null,
  label: string | null,
  reason: string | null = null,
  device: Uint8Array | null = null
): void {
  contract.set_label(new communities.set_label_arguments(communityId, actor, postId, label, reason, device));
}

// Committed happy-path steps used as fixtures by later assertions.

/** ALICE creates COMMUNITY_ID with a one-day transfer delay. */
function doCreate(): void {
  asOwner(ALICE);
  createCommunity(ALICE, COMMUNITY_ID, NAME, POLICY_HASH, POLICY_URI, DELAY);
  MockVM.commitTransaction();
}

function doCreateSecond(delay: u64): void {
  asOwner(ALICE);
  createCommunity(ALICE, SECOND_ID, "second", null, null, delay);
  MockVM.commitTransaction();
}

function doSetRole(
  actor: Uint8Array,
  subject: Uint8Array,
  role: communities.community_role,
  scope: Uint8Array | null = null,
  expiresAt: u64 = 0
): void {
  asOwner(actor);
  setRole(COMMUNITY_ID, actor, subject, role, scope, expiresAt);
  MockVM.commitTransaction();
}

function doPropose(newOwner: Uint8Array): void {
  asOwner(ALICE);
  propose(COMMUNITY_ID, ALICE, newOwner);
  MockVM.commitTransaction();
}

// Reads.

function community(id: Uint8Array): communities.community_record | null {
  return contract.get_community(new communities.get_community_arguments(id)).value;
}

function communityOrFail(id: Uint8Array): communities.community_record {
  const rec = community(id);
  expect(rec == null).toBe(false, "community record missing");
  return rec!;
}

function role(communityId: Uint8Array, subject: Uint8Array): communities.role_record | null {
  return contract.get_role(new communities.get_role_arguments(communityId, subject)).value;
}

function roleOrFail(communityId: Uint8Array, subject: Uint8Array): communities.role_record {
  const rec = role(communityId, subject);
  expect(rec == null).toBe(false, "role record missing");
  return rec!;
}

function roleValue(subject: Uint8Array): i32 {
  const rec = role(COMMUNITY_ID, subject);
  return rec == null ? -1 : <i32>rec.role;
}

// ---------------------------------------------------------------------------
// Admin: set_identity_contract / get_identity_contract
// ---------------------------------------------------------------------------

describe("communities: set_identity_contract", () => {
  beforeEach(() => {
    setup();
  });

  it("is unset by default", () => {
    const res = contract.get_identity_contract(new communities.get_identity_contract_arguments());
    expect(res.value == null).toBe(true);
  });

  it("stores the identity contract when signed by the contract account", () => {
    Testing.authorize([CONTRACT_ID]);
    contract.set_identity_contract(new communities.set_identity_contract_arguments(IDENTITY_CONTRACT));
    const res = contract.get_identity_contract(new communities.get_identity_contract_arguments());
    expect(res.value == null).toBe(false);
    expect(Arrays.equal(res.value!, IDENTITY_CONTRACT)).toBe(true);
  });

  it("rejects a signer other than the contract account", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.set_identity_contract(new communities.set_identity_contract_arguments(IDENTITY_CONTRACT));
    }).toThrow();
    expectRevert("authorization failed");
    expect(contract.get_identity_contract(new communities.get_identity_contract_arguments()).value == null).toBe(true);
  });

  it("rejects a malformed address", () => {
    Testing.authorize([CONTRACT_ID]);
    expect(() => {
      contract.set_identity_contract(new communities.set_identity_contract_arguments(filled(10, 1)));
    }).toThrow();
    expectRevert("address must be a 25-byte address");
    expect(() => {
      contract.set_identity_contract(new communities.set_identity_contract_arguments(null));
    }).toThrow();
    expectRevert("address is required");
  });

  it("can be replaced by the contract account", () => {
    configureIdentity();
    Testing.authorize([CONTRACT_ID]);
    contract.set_identity_contract(new communities.set_identity_contract_arguments(CAROL));
    const res = contract.get_identity_contract(new communities.get_identity_contract_arguments());
    expect(Arrays.equal(res.value!, CAROL)).toBe(true);
  });

  it("write methods revert while the identity contract is not configured", () => {
    asOwner(ALICE);
    expect(() => {
      createCommunity(ALICE, COMMUNITY_ID, NAME);
    }).toThrow();
    expectRevert("identity contract not configured");
    expect(community(COMMUNITY_ID) == null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// create_community
// ---------------------------------------------------------------------------

describe("communities: create_community", () => {
  beforeEach(() => {
    setupConfigured();
  });

  it("creates a community owned by the creator and emits community_created", () => {
    asOwner(ALICE);
    createCommunity(ALICE, COMMUNITY_ID, NAME, POLICY_HASH, POLICY_URI, DELAY);

    const rec = communityOrFail(COMMUNITY_ID);
    expect(Arrays.equal(rec.id!, COMMUNITY_ID)).toBe(true);
    expect(Arrays.equal(rec.owner!, ALICE)).toBe(true);
    expect(rec.name!).toBe(NAME);
    expect(Arrays.equal(rec.policy_hash!, POLICY_HASH)).toBe(true);
    expect(rec.policy_uri!).toBe(POLICY_URI);
    expect(rec.transfer_delay_ms).toBe(DELAY);
    expect(rec.pending_owner == null || rec.pending_owner!.length == 0).toBe(true);
    expect(rec.transfer_effective_at).toBe(0);
    expect(rec.created_at).toBe(T0);
    expect(rec.updated_at).toBe(T0);

    // The creator has no explicit role record: ownership is implicit.
    expect(role(COMMUNITY_ID, ALICE) == null).toBe(true);

    // Creation is an owner-key action: resolved with empty device / capability 0.
    expectOwnerResolution(ALICE);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.communities.community_created");
    expectImpacted(ev, [ALICE]);
    const data = Protobuf.decode<communities.community_created_event>(
      ev.data,
      communities.community_created_event.decode
    );
    expect(Arrays.equal(data.id!, COMMUNITY_ID)).toBe(true);
    expect(Arrays.equal(data.owner!, ALICE)).toBe(true);
    expect(data.name!).toBe(NAME);
    expect(Arrays.equal(data.policy_hash!, POLICY_HASH)).toBe(true);
    expect(data.policy_uri!).toBe(POLICY_URI);
    expect(data.transfer_delay_ms).toBe(DELAY);
    expect(data.timestamp).toBe(T0);
  });

  it("ignores the device field: the owner key is always required", () => {
    asOwner(ALICE);
    createCommunity(ALICE, COMMUNITY_ID, NAME, null, null, DELAY, DEVICE);
    expectOwnerResolution(ALICE);
    expect(community(COMMUNITY_ID) == null).toBe(false);
  });

  it("accepts a short id, empty policy fields and a zero delay", () => {
    asOwner(ALICE);
    createCommunity(ALICE, SHORT_ID, MAX_NAME, null, null, 0);
    const rec = communityOrFail(SHORT_ID);
    expect(Arrays.equal(rec.id!, SHORT_ID)).toBe(true);
    expect(rec.name!).toBe(MAX_NAME);
    expect(rec.policy_hash == null || rec.policy_hash!.length == 0).toBe(true);
    expect(rec.policy_uri == null || rec.policy_uri!.length == 0).toBe(true);
    expect(rec.transfer_delay_ms).toBe(0);
  });

  it("accepts the maximum policy_uri length and a 30-day delay", () => {
    asOwner(ALICE);
    createCommunity(ALICE, COMMUNITY_ID, NAME, POLICY_HASH, MAX_URI, THIRTY_DAYS);
    const rec = communityOrFail(COMMUNITY_ID);
    expect(rec.policy_uri!.length).toBe(256);
    expect(rec.transfer_delay_ms).toBe(THIRTY_DAYS);
  });

  it("rejects a duplicate id, even from another creator", () => {
    doCreate();
    asOwner(ALICE);
    expect(() => {
      createCommunity(ALICE, COMMUNITY_ID, "again");
    }).toThrow();
    expectRevert("community id already exists");
    asOwner(BOB);
    expect(() => {
      createCommunity(BOB, COMMUNITY_ID, "again");
    }).toThrow();
    expectRevert("community id already exists");
    // The original record is untouched.
    const rec = communityOrFail(COMMUNITY_ID);
    expect(Arrays.equal(rec.owner!, ALICE)).toBe(true);
    expect(rec.name!).toBe(NAME);
  });

  it("rejects an invalid id", () => {
    asOwner(ALICE);
    expect(() => {
      createCommunity(ALICE, null, NAME);
    }).toThrow();
    expectRevert("community id is required");
    expect(() => {
      createCommunity(ALICE, new Uint8Array(0), NAME);
    }).toThrow();
    expectRevert("community id is required");
    expect(() => {
      createCommunity(ALICE, filled(33, 1), NAME);
    }).toThrow();
    expectRevert("community id too large");
  });

  it("rejects an invalid name", () => {
    asOwner(ALICE);
    expect(() => {
      createCommunity(ALICE, COMMUNITY_ID, null);
    }).toThrow();
    expectRevert("name is required");
    expect(() => {
      createCommunity(ALICE, COMMUNITY_ID, "");
    }).toThrow();
    expectRevert("name is required");
    expect(() => {
      createCommunity(ALICE, COMMUNITY_ID, LONG_NAME);
    }).toThrow();
    expectRevert("name too long");
  });

  it("rejects a malformed policy_hash", () => {
    asOwner(ALICE);
    expect(() => {
      createCommunity(ALICE, COMMUNITY_ID, NAME, filled(31, 1));
    }).toThrow();
    expectRevert("policy_hash must be empty or 32 bytes");
  });

  it("rejects a policy_uri over 256 characters", () => {
    asOwner(ALICE);
    expect(() => {
      createCommunity(ALICE, COMMUNITY_ID, NAME, null, LONG_URI);
    }).toThrow();
    expectRevert("policy_uri too long");
  });

  it("rejects a transfer delay over 30 days", () => {
    asOwner(ALICE);
    expect(() => {
      createCommunity(ALICE, COMMUNITY_ID, NAME, null, null, THIRTY_DAYS + 1);
    }).toThrow();
    expectRevert("transfer_delay_ms too large");
    expect(community(COMMUNITY_ID) == null).toBe(true);
  });

  it("rejects a malformed creator", () => {
    asOwner(ALICE);
    expect(() => {
      createCommunity(filled(10, 1), COMMUNITY_ID, NAME);
    }).toThrow();
    expectRevert("creator must be a 25-byte address");
    expect(() => {
      createCommunity(null, COMMUNITY_ID, NAME);
    }).toThrow();
    expectRevert("creator is required");
  });

  it("rejects an unregistered creator (identity says no)", () => {
    Testing.authorize([ALICE]);
    Testing.mockResolveActor(false, null, "unregistered");
    expect(() => {
      createCommunity(ALICE, COMMUNITY_ID, NAME);
    }).toThrow();
    expectRevert("unregistered");
    expect(community(COMMUNITY_ID) == null).toBe(true);
  });

  it("rejects when the resolved signer did not sign the transaction", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "");
    expect(() => {
      createCommunity(ALICE, COMMUNITY_ID, NAME);
    }).toThrow();
    expectRevert("authorization failed");
    expect(community(COMMUNITY_ID) == null).toBe(true);
    expect(eventCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// set_role
// ---------------------------------------------------------------------------

describe("communities: set_role", () => {
  beforeEach(() => {
    setupConfigured();
    doCreate();
    clearEvents();
  });

  it("owner grants a scoped, expiring admin role and emits role_set", () => {
    asOwner(ALICE);
    setRole(COMMUNITY_ID, ALICE, BOB, ADMIN, SCOPE, T0 + DAY);

    const rec = roleOrFail(COMMUNITY_ID, BOB);
    expect(<i32>rec.role).toBe(<i32>ADMIN);
    expect(Arrays.equal(rec.scope!, SCOPE)).toBe(true);
    expect(rec.expires_at).toBe(T0 + DAY);
    expect(Arrays.equal(rec.granted_by!, ALICE)).toBe(true);
    expect(rec.granted_at).toBe(T0);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.communities.role_set");
    expectImpacted(ev, [ALICE, BOB]);
    const data = Protobuf.decode<communities.role_set_event>(ev.data, communities.role_set_event.decode);
    expect(Arrays.equal(data.community_id!, COMMUNITY_ID)).toBe(true);
    expect(Arrays.equal(data.actor!, ALICE)).toBe(true);
    expect(Arrays.equal(data.subject!, BOB)).toBe(true);
    expect(<i32>data.role).toBe(<i32>ADMIN);
    expect(Arrays.equal(data.scope!, SCOPE)).toBe(true);
    expect(data.expires_at).toBe(T0 + DAY);
    expect(data.timestamp).toBe(T0);

    // The community record itself is not touched by role changes.
    expect(communityOrFail(COMMUNITY_ID).updated_at).toBe(T0);
  });

  it("owner may set every role below owner, including banned", () => {
    doSetRole(ALICE, BOB, GUEST);
    expect(roleValue(BOB)).toBe(<i32>GUEST);
    doSetRole(ALICE, BOB, MEMBER);
    expect(roleValue(BOB)).toBe(<i32>MEMBER);
    doSetRole(ALICE, BOB, MODERATOR);
    expect(roleValue(BOB)).toBe(<i32>MODERATOR);
    doSetRole(ALICE, BOB, ADMIN);
    expect(roleValue(BOB)).toBe(<i32>ADMIN);
    doSetRole(ALICE, BOB, BANNED);
    expect(roleValue(BOB)).toBe(<i32>BANNED);
  });

  it("role none deletes the record and still emits role_set", () => {
    doSetRole(ALICE, BOB, MEMBER);
    expect(role(COMMUNITY_ID, BOB) == null).toBe(false);
    clearEvents();

    asOwner(ALICE);
    setRole(COMMUNITY_ID, ALICE, BOB, NONE);
    expect(role(COMMUNITY_ID, BOB) == null).toBe(true);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.communities.role_set");
    const data = Protobuf.decode<communities.role_set_event>(ev.data, communities.role_set_event.decode);
    expect(<i32>data.role).toBe(<i32>NONE);
    expect(Arrays.equal(data.subject!, BOB)).toBe(true);
  });

  it("re-granting overwrites scope, expiry and grantor", () => {
    doSetRole(ALICE, BOB, ADMIN);
    doSetRole(ALICE, CAROL, MODERATOR, SCOPE, T0 + DAY);
    advanceTo(T0 + HOUR);
    asOwner(BOB);
    setRole(COMMUNITY_ID, BOB, CAROL, MEMBER);
    const rec = roleOrFail(COMMUNITY_ID, CAROL);
    expect(<i32>rec.role).toBe(<i32>MEMBER);
    expect(rec.scope == null || rec.scope!.length == 0).toBe(true);
    expect(rec.expires_at).toBe(0);
    expect(Arrays.equal(rec.granted_by!, BOB)).toBe(true);
    expect(rec.granted_at).toBe(T0 + HOUR);
  });

  it("owner cannot set the owner role (use ownership transfer)", () => {
    asOwner(ALICE);
    expect(() => {
      setRole(COMMUNITY_ID, ALICE, BOB, OWNER);
    }).toThrow();
    expectRevert("use ownership transfer");
    expect(role(COMMUNITY_ID, BOB) == null).toBe(true);
    expect(eventCount()).toBe(0);
  });

  it("nobody can change the owner's role", () => {
    asOwner(ALICE);
    expect(() => {
      setRole(COMMUNITY_ID, ALICE, ALICE, ADMIN);
    }).toThrow();
    expectRevert("cannot change owner role");

    doSetRole(ALICE, BOB, ADMIN);
    asOwner(BOB);
    expect(() => {
      setRole(COMMUNITY_ID, BOB, ALICE, BANNED);
    }).toThrow();
    expectRevert("cannot change owner role");
    expect(role(COMMUNITY_ID, ALICE) == null).toBe(true);
  });

  it("admin grants, changes and revokes roles below admin", () => {
    doSetRole(ALICE, BOB, ADMIN);
    clearEvents();

    asOwner(BOB);
    setRole(COMMUNITY_ID, BOB, CAROL, MODERATOR);
    let rec = roleOrFail(COMMUNITY_ID, CAROL);
    expect(<i32>rec.role).toBe(<i32>MODERATOR);
    expect(Arrays.equal(rec.granted_by!, BOB)).toBe(true);
    expectImpacted(lastEvent(), [BOB, CAROL]);
    MockVM.commitTransaction();

    asOwner(BOB);
    setRole(COMMUNITY_ID, BOB, CAROL, GUEST);
    expect(roleValue(CAROL)).toBe(<i32>GUEST);
    MockVM.commitTransaction();

    asOwner(BOB);
    setRole(COMMUNITY_ID, BOB, CAROL, BANNED);
    expect(roleValue(CAROL)).toBe(<i32>BANNED);
    MockVM.commitTransaction();

    asOwner(BOB);
    setRole(COMMUNITY_ID, BOB, CAROL, MEMBER);
    expect(roleValue(CAROL)).toBe(<i32>MEMBER);
    MockVM.commitTransaction();

    asOwner(BOB);
    setRole(COMMUNITY_ID, BOB, CAROL, NONE);
    expect(role(COMMUNITY_ID, CAROL) == null).toBe(true);
  });

  it("admin cannot grant admin or owner", () => {
    doSetRole(ALICE, BOB, ADMIN);
    asOwner(BOB);
    expect(() => {
      setRole(COMMUNITY_ID, BOB, CAROL, ADMIN);
    }).toThrow();
    expectRevert("admin may only set roles below admin");
    expect(role(COMMUNITY_ID, CAROL) == null).toBe(true);

    asOwner(BOB);
    expect(() => {
      setRole(COMMUNITY_ID, BOB, CAROL, OWNER);
    }).toThrow();
    expectRevert("use ownership transfer");
  });

  it("admin cannot change another admin's role, nor its own", () => {
    doSetRole(ALICE, BOB, ADMIN);
    doSetRole(ALICE, CAROL, ADMIN);

    asOwner(BOB);
    expect(() => {
      setRole(COMMUNITY_ID, BOB, CAROL, MEMBER);
    }).toThrow();
    expectRevert("admin cannot change an admin's role");
    expect(roleValue(CAROL)).toBe(<i32>ADMIN);

    asOwner(BOB);
    expect(() => {
      setRole(COMMUNITY_ID, BOB, CAROL, BANNED);
    }).toThrow();
    expectRevert("admin cannot change an admin's role");

    asOwner(BOB);
    expect(() => {
      setRole(COMMUNITY_ID, BOB, BOB, MEMBER);
    }).toThrow();
    expectRevert("admin cannot change an admin's role");
    expect(roleValue(BOB)).toBe(<i32>ADMIN);
  });

  it("admin may change an admin whose role has expired", () => {
    doSetRole(ALICE, CAROL, ADMIN, null, T0 + HOUR);
    doSetRole(ALICE, BOB, ADMIN);
    advanceTo(T0 + HOUR);
    asOwner(BOB);
    setRole(COMMUNITY_ID, BOB, CAROL, MEMBER);
    expect(roleValue(CAROL)).toBe(<i32>MEMBER);
  });

  it("owner can demote or ban an admin", () => {
    doSetRole(ALICE, BOB, ADMIN);
    doSetRole(ALICE, BOB, BANNED);
    expect(roleValue(BOB)).toBe(<i32>BANNED);
    asOwner(BOB);
    expect(() => {
      setRole(COMMUNITY_ID, BOB, CAROL, MEMBER);
    }).toThrow();
    expectRevert("insufficient role");
  });

  it("moderators, members, guests, banned and unknown accounts cannot set roles", () => {
    doSetRole(ALICE, BOB, MODERATOR);
    asOwner(BOB);
    expect(() => {
      setRole(COMMUNITY_ID, BOB, CAROL, MEMBER);
    }).toThrow();
    expectRevert("insufficient role");

    doSetRole(ALICE, BOB, MEMBER);
    asOwner(BOB);
    expect(() => {
      setRole(COMMUNITY_ID, BOB, CAROL, GUEST);
    }).toThrow();
    expectRevert("insufficient role");

    doSetRole(ALICE, BOB, GUEST);
    asOwner(BOB);
    expect(() => {
      setRole(COMMUNITY_ID, BOB, CAROL, GUEST);
    }).toThrow();
    expectRevert("insufficient role");

    doSetRole(ALICE, BOB, BANNED);
    asOwner(BOB);
    expect(() => {
      setRole(COMMUNITY_ID, BOB, CAROL, NONE);
    }).toThrow();
    expectRevert("insufficient role");

    asOwner(DAVE);
    expect(() => {
      setRole(COMMUNITY_ID, DAVE, CAROL, MEMBER);
    }).toThrow();
    expectRevert("insufficient role");
    expect(role(COMMUNITY_ID, CAROL) == null).toBe(true);
  });

  it("an expired admin role is ignored", () => {
    doSetRole(ALICE, BOB, ADMIN, null, T0 + HOUR);

    // Still valid one millisecond before expiry.
    advanceTo(T0 + HOUR - 1);
    asOwner(BOB);
    setRole(COMMUNITY_ID, BOB, CAROL, MEMBER);
    MockVM.commitTransaction();
    expect(roleValue(CAROL)).toBe(<i32>MEMBER);

    // Expired at exactly expires_at.
    advanceTo(T0 + HOUR);
    asOwner(BOB);
    expect(() => {
      setRole(COMMUNITY_ID, BOB, CAROL, MODERATOR);
    }).toThrow();
    expectRevert("insufficient role");
    expect(roleValue(CAROL)).toBe(<i32>MEMBER);
    // The stale record is still readable; callers compute effective roles.
    expect(roleValue(BOB)).toBe(<i32>ADMIN);
  });

  it("rejects expires_at at or before now", () => {
    asOwner(ALICE);
    expect(() => {
      setRole(COMMUNITY_ID, ALICE, BOB, MEMBER, null, T0);
    }).toThrow();
    expectRevert("expires_at must be 0 or in the future");
    asOwner(ALICE);
    expect(() => {
      setRole(COMMUNITY_ID, ALICE, BOB, MEMBER, null, T0 - 1);
    }).toThrow();
    expectRevert("expires_at must be 0 or in the future");
    asOwner(ALICE);
    setRole(COMMUNITY_ID, ALICE, BOB, MEMBER, null, T0 + 1);
    expect(roleOrFail(COMMUNITY_ID, BOB).expires_at).toBe(T0 + 1);
  });

  it("rejects a scope over 32 bytes and accepts exactly 32", () => {
    asOwner(ALICE);
    expect(() => {
      setRole(COMMUNITY_ID, ALICE, BOB, MEMBER, filled(33, 7));
    }).toThrow();
    expectRevert("scope too large");
    asOwner(ALICE);
    setRole(COMMUNITY_ID, ALICE, BOB, MEMBER, filled(32, 7));
    expect(roleOrFail(COMMUNITY_ID, BOB).scope!.length).toBe(32);
  });

  it("rejects an invalid role value", () => {
    asOwner(ALICE);
    expect(() => {
      setRole(COMMUNITY_ID, ALICE, BOB, <communities.community_role>7);
    }).toThrow();
    expectRevert("invalid role");
    asOwner(ALICE);
    expect(() => {
      setRole(COMMUNITY_ID, ALICE, BOB, <communities.community_role>-1);
    }).toThrow();
    expectRevert("invalid role");
  });

  it("rejects an unknown community", () => {
    asOwner(ALICE);
    expect(() => {
      setRole(SECOND_ID, ALICE, BOB, MEMBER);
    }).toThrow();
    expectRevert("community not found");
  });

  it("rejects malformed arguments", () => {
    asOwner(ALICE);
    expect(() => {
      setRole(null, ALICE, BOB, MEMBER);
    }).toThrow();
    expectRevert("community id is required");
    asOwner(ALICE);
    expect(() => {
      setRole(COMMUNITY_ID, filled(3, 1), BOB, MEMBER);
    }).toThrow();
    expectRevert("actor must be a 25-byte address");
    asOwner(ALICE);
    expect(() => {
      setRole(COMMUNITY_ID, ALICE, null, MEMBER);
    }).toThrow();
    expectRevert("subject is required");
  });

  it("accepts a device key holding the COMMUNITY capability", () => {
    asDevice(DEVICE);
    setRole(COMMUNITY_ID, ALICE, BOB, MEMBER, null, 0, DEVICE);
    expectDeviceResolution(ALICE, DEVICE);
    const rec = roleOrFail(COMMUNITY_ID, BOB);
    expect(<i32>rec.role).toBe(<i32>MEMBER);
    // granted_by is the acting identity, not the device key.
    expect(Arrays.equal(rec.granted_by!, ALICE)).toBe(true);
  });

  it("rejects when the identity contract refuses the device", () => {
    Testing.authorize([DEVICE]);
    Testing.mockResolveActor(false, null, "device capability missing");
    expect(() => {
      setRole(COMMUNITY_ID, ALICE, BOB, MEMBER, null, 0, DEVICE);
    }).toThrow();
    expectRevert("device capability missing");
    expect(role(COMMUNITY_ID, BOB) == null).toBe(true);
  });

  it("rejects when the resolved signer did not sign", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "");
    expect(() => {
      setRole(COMMUNITY_ID, ALICE, BOB, ADMIN);
    }).toThrow();
    expectRevert("authorization failed");
    expect(role(COMMUNITY_ID, BOB) == null).toBe(true);
    expect(eventCount()).toBe(0);
  });

  it("roles are scoped to one community", () => {
    doCreateSecond(DELAY);
    doSetRole(ALICE, BOB, ADMIN);
    expect(role(SECOND_ID, BOB) == null).toBe(true);
    asOwner(BOB);
    expect(() => {
      setRole(SECOND_ID, BOB, CAROL, MEMBER);
    }).toThrow();
    expectRevert("insufficient role");
  });
});

// ---------------------------------------------------------------------------
// set_policy
// ---------------------------------------------------------------------------

describe("communities: set_policy", () => {
  beforeEach(() => {
    setupConfigured();
    doCreate();
    clearEvents();
  });

  it("owner updates the policy and emits policy_set", () => {
    advanceTo(T0 + HOUR);
    asOwner(ALICE);
    setPolicy(COMMUNITY_ID, ALICE, OTHER_HASH, "ipfs://policy-v2");

    const rec = communityOrFail(COMMUNITY_ID);
    expect(Arrays.equal(rec.policy_hash!, OTHER_HASH)).toBe(true);
    expect(rec.policy_uri!).toBe("ipfs://policy-v2");
    expect(rec.updated_at).toBe(T0 + HOUR);
    expect(rec.created_at).toBe(T0);
    expect(Arrays.equal(rec.owner!, ALICE)).toBe(true);
    expect(rec.name!).toBe(NAME);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.communities.policy_set");
    expectImpacted(ev, [ALICE]);
    const data = Protobuf.decode<communities.policy_set_event>(ev.data, communities.policy_set_event.decode);
    expect(Arrays.equal(data.community_id!, COMMUNITY_ID)).toBe(true);
    expect(Arrays.equal(data.actor!, ALICE)).toBe(true);
    expect(Arrays.equal(data.policy_hash!, OTHER_HASH)).toBe(true);
    expect(data.policy_uri!).toBe("ipfs://policy-v2");
    expect(data.timestamp).toBe(T0 + HOUR);
  });

  it("admin may update the policy", () => {
    doSetRole(ALICE, BOB, ADMIN);
    clearEvents();
    asOwner(BOB);
    setPolicy(COMMUNITY_ID, BOB, OTHER_HASH, "ipfs://policy-v2");
    const rec = communityOrFail(COMMUNITY_ID);
    expect(Arrays.equal(rec.policy_hash!, OTHER_HASH)).toBe(true);
    expectImpacted(lastEvent(), [BOB]);
  });

  it("clears the policy with empty values", () => {
    asOwner(ALICE);
    setPolicy(COMMUNITY_ID, ALICE, null, null);
    const rec = communityOrFail(COMMUNITY_ID);
    expect(rec.policy_hash == null || rec.policy_hash!.length == 0).toBe(true);
    expect(rec.policy_uri == null || rec.policy_uri!.length == 0).toBe(true);
  });

  it("moderators, members and outsiders cannot update the policy", () => {
    doSetRole(ALICE, BOB, MODERATOR);
    asOwner(BOB);
    expect(() => {
      setPolicy(COMMUNITY_ID, BOB, OTHER_HASH, "x");
    }).toThrow();
    expectRevert("insufficient role");

    doSetRole(ALICE, BOB, MEMBER);
    clearEvents();
    asOwner(BOB);
    expect(() => {
      setPolicy(COMMUNITY_ID, BOB, OTHER_HASH, "x");
    }).toThrow();
    expectRevert("insufficient role");

    asOwner(DAVE);
    expect(() => {
      setPolicy(COMMUNITY_ID, DAVE, OTHER_HASH, "x");
    }).toThrow();
    expectRevert("insufficient role");

    const rec = communityOrFail(COMMUNITY_ID);
    expect(Arrays.equal(rec.policy_hash!, POLICY_HASH)).toBe(true);
    expect(rec.policy_uri!).toBe(POLICY_URI);
    expect(eventCount()).toBe(0);
  });

  it("an expired admin cannot update the policy", () => {
    doSetRole(ALICE, BOB, ADMIN, null, T0 + HOUR);
    advanceTo(T0 + HOUR);
    asOwner(BOB);
    expect(() => {
      setPolicy(COMMUNITY_ID, BOB, OTHER_HASH, "x");
    }).toThrow();
    expectRevert("insufficient role");
  });

  it("rejects a malformed policy_hash or a long policy_uri", () => {
    asOwner(ALICE);
    expect(() => {
      setPolicy(COMMUNITY_ID, ALICE, filled(20, 1), "x");
    }).toThrow();
    expectRevert("policy_hash must be empty or 32 bytes");
    asOwner(ALICE);
    expect(() => {
      setPolicy(COMMUNITY_ID, ALICE, OTHER_HASH, LONG_URI);
    }).toThrow();
    expectRevert("policy_uri too long");
    expect(Arrays.equal(communityOrFail(COMMUNITY_ID).policy_hash!, POLICY_HASH)).toBe(true);
  });

  it("rejects an unknown community", () => {
    asOwner(ALICE);
    expect(() => {
      setPolicy(SECOND_ID, ALICE, OTHER_HASH, "x");
    }).toThrow();
    expectRevert("community not found");
  });

  it("accepts a device key holding the COMMUNITY capability", () => {
    asDevice(DEVICE);
    setPolicy(COMMUNITY_ID, ALICE, OTHER_HASH, "x", DEVICE);
    expectDeviceResolution(ALICE, DEVICE);
    expect(Arrays.equal(communityOrFail(COMMUNITY_ID).policy_hash!, OTHER_HASH)).toBe(true);
  });

  it("rejects when the resolved signer did not sign", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "");
    expect(() => {
      setPolicy(COMMUNITY_ID, ALICE, OTHER_HASH, "x");
    }).toThrow();
    expectRevert("authorization failed");
    expect(Arrays.equal(communityOrFail(COMMUNITY_ID).policy_hash!, POLICY_HASH)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ownership transfer: propose / cancel / execute
// ---------------------------------------------------------------------------

describe("communities: ownership transfer", () => {
  beforeEach(() => {
    setupConfigured();
    doCreate();
    clearEvents();
  });

  it("owner proposes a transfer: pending owner, effective_at = now + delay, event", () => {
    asOwner(ALICE);
    propose(COMMUNITY_ID, ALICE, BOB);

    const rec = communityOrFail(COMMUNITY_ID);
    expect(Arrays.equal(rec.owner!, ALICE)).toBe(true);
    expect(Arrays.equal(rec.pending_owner!, BOB)).toBe(true);
    expect(rec.transfer_effective_at).toBe(T0 + DELAY);
    expect(rec.updated_at).toBe(T0);

    // Owner-key only: resolved with empty device / capability 0.
    expectOwnerResolution(ALICE);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.communities.owner_transfer_proposed");
    expectImpacted(ev, [ALICE, BOB]);
    const data = Protobuf.decode<communities.owner_transfer_proposed_event>(
      ev.data,
      communities.owner_transfer_proposed_event.decode
    );
    expect(Arrays.equal(data.community_id!, COMMUNITY_ID)).toBe(true);
    expect(Arrays.equal(data.owner!, ALICE)).toBe(true);
    expect(Arrays.equal(data.new_owner!, BOB)).toBe(true);
    expect(data.effective_at).toBe(T0 + DELAY);
  });

  it("rejects a proposal from anyone but the owner, even an admin", () => {
    doSetRole(ALICE, BOB, ADMIN);
    asOwner(BOB);
    expect(() => {
      propose(COMMUNITY_ID, BOB, CAROL);
    }).toThrow();
    expectRevert("only the owner may propose a transfer");
    const rec = communityOrFail(COMMUNITY_ID);
    expect(rec.pending_owner == null || rec.pending_owner!.length == 0).toBe(true);
  });

  it("rejects new_owner equal to the owner or malformed", () => {
    asOwner(ALICE);
    expect(() => {
      propose(COMMUNITY_ID, ALICE, ALICE);
    }).toThrow();
    expectRevert("new_owner must differ from owner");
    asOwner(ALICE);
    expect(() => {
      propose(COMMUNITY_ID, ALICE, filled(5, 1));
    }).toThrow();
    expectRevert("new_owner must be a 25-byte address");
    asOwner(ALICE);
    expect(() => {
      propose(COMMUNITY_ID, ALICE, null);
    }).toThrow();
    expectRevert("new_owner is required");
  });

  it("rejects an unknown community and a missing owner argument", () => {
    asOwner(ALICE);
    expect(() => {
      propose(SECOND_ID, ALICE, BOB);
    }).toThrow();
    expectRevert("community not found");
    asOwner(ALICE);
    expect(() => {
      propose(COMMUNITY_ID, null, BOB);
    }).toThrow();
    expectRevert("owner is required");
  });

  it("rejects a proposal when the owner did not sign", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "");
    expect(() => {
      propose(COMMUNITY_ID, ALICE, BOB);
    }).toThrow();
    expectRevert("authorization failed");
    const rec = communityOrFail(COMMUNITY_ID);
    expect(rec.pending_owner == null || rec.pending_owner!.length == 0).toBe(true);
  });

  it("a new proposal replaces the pending one and restarts the delay", () => {
    doPropose(BOB);
    advanceTo(T0 + HOUR);
    asOwner(ALICE);
    propose(COMMUNITY_ID, ALICE, CAROL);
    const rec = communityOrFail(COMMUNITY_ID);
    expect(Arrays.equal(rec.pending_owner!, CAROL)).toBe(true);
    expect(rec.transfer_effective_at).toBe(T0 + HOUR + DELAY);
  });

  it("owner cancels the pending transfer and emits owner_transfer_cancelled", () => {
    doPropose(BOB);
    clearEvents();
    advanceTo(T0 + HOUR);
    asOwner(ALICE);
    cancel(COMMUNITY_ID, ALICE);

    const rec = communityOrFail(COMMUNITY_ID);
    expect(Arrays.equal(rec.owner!, ALICE)).toBe(true);
    expect(rec.pending_owner == null || rec.pending_owner!.length == 0).toBe(true);
    expect(rec.transfer_effective_at).toBe(0);
    expect(rec.updated_at).toBe(T0 + HOUR);
    expectOwnerResolution(ALICE);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.communities.owner_transfer_cancelled");
    expectImpacted(ev, [ALICE, BOB]);
    const data = Protobuf.decode<communities.owner_transfer_cancelled_event>(
      ev.data,
      communities.owner_transfer_cancelled_event.decode
    );
    expect(Arrays.equal(data.community_id!, COMMUNITY_ID)).toBe(true);
    expect(data.timestamp).toBe(T0 + HOUR);
  });

  it("cancel requires a pending transfer", () => {
    asOwner(ALICE);
    expect(() => {
      cancel(COMMUNITY_ID, ALICE);
    }).toThrow();
    expectRevert("no pending transfer");
  });

  it("cancel requires the owner: the pending owner cannot cancel", () => {
    doPropose(BOB);
    asOwner(BOB);
    expect(() => {
      cancel(COMMUNITY_ID, BOB);
    }).toThrow();
    expectRevert("only the owner may cancel a transfer");
    expect(Arrays.equal(communityOrFail(COMMUNITY_ID).pending_owner!, BOB)).toBe(true);

    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "");
    expect(() => {
      cancel(COMMUNITY_ID, ALICE);
    }).toThrow();
    expectRevert("authorization failed");
  });

  it("execute before the delay has elapsed is rejected", () => {
    doPropose(BOB);
    Testing.authorize([]);
    expect(() => {
      execute(COMMUNITY_ID);
    }).toThrow();
    expectRevert("transfer delay not elapsed");

    advanceTo(T0 + DELAY - 1);
    expect(() => {
      execute(COMMUNITY_ID);
    }).toThrow();
    expectRevert("transfer delay not elapsed");

    const rec = communityOrFail(COMMUNITY_ID);
    expect(Arrays.equal(rec.owner!, ALICE)).toBe(true);
    expect(Arrays.equal(rec.pending_owner!, BOB)).toBe(true);
  });

  it("execute at the effective time transfers ownership without any signer", () => {
    doPropose(BOB);
    clearEvents();
    advanceTo(T0 + DELAY);
    Testing.authorize([]);
    const callsBefore = callCount();
    execute(COMMUNITY_ID);

    const rec = communityOrFail(COMMUNITY_ID);
    expect(Arrays.equal(rec.owner!, BOB)).toBe(true);
    expect(rec.pending_owner == null || rec.pending_owner!.length == 0).toBe(true);
    expect(rec.transfer_effective_at).toBe(0);
    expect(rec.updated_at).toBe(T0 + DELAY);
    expect(rec.created_at).toBe(T0);
    // No identity call is made by execute_owner_transfer.
    expect(callCount()).toBe(callsBefore);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.communities.owner_transferred");
    expectImpacted(ev, [ALICE, BOB]);
    const data = Protobuf.decode<communities.owner_transferred_event>(
      ev.data,
      communities.owner_transferred_event.decode
    );
    expect(Arrays.equal(data.community_id!, COMMUNITY_ID)).toBe(true);
    expect(Arrays.equal(data.previous_owner!, ALICE)).toBe(true);
    expect(Arrays.equal(data.new_owner!, BOB)).toBe(true);
    expect(data.timestamp).toBe(T0 + DELAY);
  });

  it("after the transfer the new owner has owner powers and the old owner has none", () => {
    doPropose(BOB);
    advanceTo(T0 + DELAY);
    Testing.authorize([]);
    execute(COMMUNITY_ID);
    MockVM.commitTransaction();

    // Previous owner is now an outsider.
    asOwner(ALICE);
    expect(() => {
      setRole(COMMUNITY_ID, ALICE, CAROL, MEMBER);
    }).toThrow();
    expectRevert("insufficient role");
    asOwner(ALICE);
    expect(() => {
      propose(COMMUNITY_ID, ALICE, CAROL);
    }).toThrow();
    expectRevert("only the owner may propose a transfer");

    // New owner may grant admin and propose a transfer back.
    asOwner(BOB);
    setRole(COMMUNITY_ID, BOB, ALICE, ADMIN);
    MockVM.commitTransaction();
    expect(roleValue(ALICE)).toBe(<i32>ADMIN);
    asOwner(BOB);
    propose(COMMUNITY_ID, BOB, ALICE);
    expect(Arrays.equal(communityOrFail(COMMUNITY_ID).pending_owner!, ALICE)).toBe(true);
  });

  it("execute deletes any explicit role record of the new owner", () => {
    doSetRole(ALICE, BOB, MODERATOR);
    doSetRole(ALICE, CAROL, ADMIN);
    doPropose(BOB);
    advanceTo(T0 + DELAY);
    Testing.authorize([]);
    execute(COMMUNITY_ID);
    expect(role(COMMUNITY_ID, BOB) == null).toBe(true);
    // Other roles are untouched.
    expect(roleValue(CAROL)).toBe(<i32>ADMIN);
  });

  it("execute requires a pending transfer and cannot run twice", () => {
    Testing.authorize([]);
    expect(() => {
      execute(COMMUNITY_ID);
    }).toThrow();
    expectRevert("no pending transfer");

    doPropose(BOB);
    advanceTo(T0 + DELAY);
    execute(COMMUNITY_ID);
    MockVM.commitTransaction();
    expect(() => {
      execute(COMMUNITY_ID);
    }).toThrow();
    expectRevert("no pending transfer");
    expect(Arrays.equal(communityOrFail(COMMUNITY_ID).owner!, BOB)).toBe(true);
  });

  it("a cancelled transfer cannot be executed", () => {
    doPropose(BOB);
    asOwner(ALICE);
    cancel(COMMUNITY_ID, ALICE);
    MockVM.commitTransaction();
    advanceTo(T0 + DELAY);
    Testing.authorize([]);
    expect(() => {
      execute(COMMUNITY_ID);
    }).toThrow();
    expectRevert("no pending transfer");
    expect(Arrays.equal(communityOrFail(COMMUNITY_ID).owner!, ALICE)).toBe(true);
  });

  it("execute rejects an unknown community", () => {
    Testing.authorize([]);
    expect(() => {
      execute(SECOND_ID);
    }).toThrow();
    expectRevert("community not found");
    expect(() => {
      execute(null);
    }).toThrow();
    expectRevert("community id is required");
  });

  it("a zero delay makes the transfer executable immediately", () => {
    doCreateSecond(0);
    asOwner(ALICE);
    propose(SECOND_ID, ALICE, CAROL);
    MockVM.commitTransaction();
    expect(communityOrFail(SECOND_ID).transfer_effective_at).toBe(T0);
    Testing.authorize([]);
    execute(SECOND_ID);
    expect(Arrays.equal(communityOrFail(SECOND_ID).owner!, CAROL)).toBe(true);
    // The first community is unaffected.
    expect(Arrays.equal(communityOrFail(COMMUNITY_ID).owner!, ALICE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// set_label
// ---------------------------------------------------------------------------

describe("communities: set_label", () => {
  beforeEach(() => {
    setupConfigured();
    doCreate();
    clearEvents();
  });

  it("moderator labels a post: emits label_set only, no state change", () => {
    doSetRole(ALICE, CAROL, MODERATOR);
    clearEvents();
    advanceTo(T0 + HOUR);
    asOwner(CAROL);
    setLabel(COMMUNITY_ID, CAROL, POST_ID, "hide", "spam");

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.communities.label_set");
    expectImpacted(ev, [CAROL]);
    const data = Protobuf.decode<communities.label_set_event>(ev.data, communities.label_set_event.decode);
    expect(Arrays.equal(data.community_id!, COMMUNITY_ID)).toBe(true);
    expect(Arrays.equal(data.actor!, CAROL)).toBe(true);
    expect(Arrays.equal(data.post_id!, POST_ID)).toBe(true);
    expect(data.label!).toBe("hide");
    expect(data.reason!).toBe("spam");
    expect(data.timestamp).toBe(T0 + HOUR);

    // Nothing in state changes.
    const rec = communityOrFail(COMMUNITY_ID);
    expect(rec.updated_at).toBe(T0);
    const r = roleOrFail(COMMUNITY_ID, CAROL);
    expect(<i32>r.role).toBe(<i32>MODERATOR);
    expect(r.granted_at).toBe(T0);
  });

  it("owner and admin may label; the same post may be labelled repeatedly", () => {
    asOwner(ALICE);
    setLabel(COMMUNITY_ID, ALICE, POST_ID, "warn:nsfw", "");
    MockVM.commitTransaction();
    expectImpacted(lastEvent(), [ALICE]);

    doSetRole(ALICE, BOB, ADMIN);
    clearEvents();
    asOwner(BOB);
    setLabel(COMMUNITY_ID, BOB, POST_ID, "appeal:granted", null);
    expectImpacted(lastEvent(), [BOB]);
    const data = Protobuf.decode<communities.label_set_event>(lastEvent().data, communities.label_set_event.decode);
    expect(data.label!).toBe("appeal:granted");
    expect(data.reason == null || data.reason!.length == 0).toBe(true);
  });

  it("a scoped moderator may label (scope is not enforced on chain)", () => {
    doSetRole(ALICE, CAROL, MODERATOR, SCOPE, T0 + DAY);
    asOwner(CAROL);
    setLabel(COMMUNITY_ID, CAROL, POST_ID, "hide", "off-topic");
    expect(lastEvent().name).toBe("osp.communities.label_set");
  });

  it("members, guests and outsiders cannot label", () => {
    doSetRole(ALICE, CAROL, MEMBER);
    asOwner(CAROL);
    expect(() => {
      setLabel(COMMUNITY_ID, CAROL, POST_ID, "hide", "spam");
    }).toThrow();
    expectRevert("insufficient role");

    doSetRole(ALICE, CAROL, GUEST);
    clearEvents();
    asOwner(CAROL);
    expect(() => {
      setLabel(COMMUNITY_ID, CAROL, POST_ID, "hide", "spam");
    }).toThrow();
    expectRevert("insufficient role");

    asOwner(DAVE);
    expect(() => {
      setLabel(COMMUNITY_ID, DAVE, POST_ID, "hide", "spam");
    }).toThrow();
    expectRevert("insufficient role");
    expect(eventCount()).toBe(0);
  });

  it("banned users cannot label, even former moderators", () => {
    doSetRole(ALICE, CAROL, MODERATOR);
    doSetRole(ALICE, CAROL, BANNED);
    clearEvents();
    asOwner(CAROL);
    expect(() => {
      setLabel(COMMUNITY_ID, CAROL, POST_ID, "hide", "spam");
    }).toThrow();
    expectRevert("insufficient role");
    expect(eventCount()).toBe(0);
  });

  it("an expired moderator cannot label", () => {
    doSetRole(ALICE, CAROL, MODERATOR, null, T0 + HOUR);
    clearEvents();
    advanceTo(T0 + HOUR - 1);
    asOwner(CAROL);
    setLabel(COMMUNITY_ID, CAROL, POST_ID, "hide", "spam");
    MockVM.commitTransaction();
    expect(eventCount()).toBe(1);

    advanceTo(T0 + HOUR);
    asOwner(CAROL);
    expect(() => {
      setLabel(COMMUNITY_ID, CAROL, POST_ID, "hide", "spam");
    }).toThrow();
    expectRevert("insufficient role");
  });

  it("rejects an invalid post_id", () => {
    asOwner(ALICE);
    expect(() => {
      setLabel(COMMUNITY_ID, ALICE, null, "hide", "spam");
    }).toThrow();
    expectRevert("post_id is required");
    asOwner(ALICE);
    expect(() => {
      setLabel(COMMUNITY_ID, ALICE, filled(31, 1), "hide", "spam");
    }).toThrow();
    expectRevert("post_id must be 32 bytes");
    asOwner(ALICE);
    expect(() => {
      setLabel(COMMUNITY_ID, ALICE, filled(33, 1), "hide", "spam");
    }).toThrow();
    expectRevert("post_id too large");
  });

  it("rejects an invalid label and accepts the maximum length", () => {
    asOwner(ALICE);
    expect(() => {
      setLabel(COMMUNITY_ID, ALICE, POST_ID, null, "spam");
    }).toThrow();
    expectRevert("label is required");
    asOwner(ALICE);
    expect(() => {
      setLabel(COMMUNITY_ID, ALICE, POST_ID, "", "spam");
    }).toThrow();
    expectRevert("label is required");
    asOwner(ALICE);
    expect(() => {
      setLabel(COMMUNITY_ID, ALICE, POST_ID, LONG_LABEL, "spam");
    }).toThrow();
    expectRevert("label too long");
    asOwner(ALICE);
    setLabel(COMMUNITY_ID, ALICE, POST_ID, MAX_LABEL, "spam");
    expect(eventCount()).toBe(1);
  });

  it("rejects a reason over 256 characters", () => {
    asOwner(ALICE);
    expect(() => {
      setLabel(COMMUNITY_ID, ALICE, POST_ID, "hide", LONG_REASON);
    }).toThrow();
    expectRevert("reason too long");
    expect(eventCount()).toBe(0);
  });

  it("rejects an unknown community", () => {
    asOwner(ALICE);
    expect(() => {
      setLabel(SECOND_ID, ALICE, POST_ID, "hide", "spam");
    }).toThrow();
    expectRevert("community not found");
  });

  it("accepts a device key holding the COMMUNITY capability", () => {
    doSetRole(ALICE, CAROL, MODERATOR);
    clearEvents();
    asDevice(DEVICE);
    setLabel(COMMUNITY_ID, CAROL, POST_ID, "hide", "spam", DEVICE);
    expectDeviceResolution(CAROL, DEVICE);
    const data = Protobuf.decode<communities.label_set_event>(lastEvent().data, communities.label_set_event.decode);
    // The event names the acting identity, not the device key.
    expect(Arrays.equal(data.actor!, CAROL)).toBe(true);
  });

  it("rejects when the resolved signer did not sign", () => {
    doSetRole(ALICE, CAROL, MODERATOR);
    clearEvents();
    Testing.authorize([DAVE]);
    Testing.mockResolveActor(true, CAROL, "");
    expect(() => {
      setLabel(COMMUNITY_ID, CAROL, POST_ID, "hide", "spam");
    }).toThrow();
    expectRevert("authorization failed");
    expect(eventCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe("communities: reads", () => {
  beforeEach(() => {
    setupConfigured();
  });

  it("get_community returns null for a missing or empty id", () => {
    expect(community(COMMUNITY_ID) == null).toBe(true);
    expect(contract.get_community(new communities.get_community_arguments(null)).value == null).toBe(true);
    expect(contract.get_community(new communities.get_community_arguments(new Uint8Array(0))).value == null).toBe(true);
  });

  it("get_role returns null for a missing record or empty arguments", () => {
    doCreate();
    expect(role(COMMUNITY_ID, BOB) == null).toBe(true);
    expect(role(SECOND_ID, BOB) == null).toBe(true);
    expect(contract.get_role(new communities.get_role_arguments(null, BOB)).value == null).toBe(true);
    expect(contract.get_role(new communities.get_role_arguments(COMMUNITY_ID, null)).value == null).toBe(true);
  });

  it("get_role returns the stored record even after expiry (callers compute effective roles)", () => {
    doCreate();
    doSetRole(ALICE, BOB, MODERATOR, SCOPE, T0 + HOUR);
    advanceTo(T0 + DAY);
    const rec = roleOrFail(COMMUNITY_ID, BOB);
    expect(<i32>rec.role).toBe(<i32>MODERATOR);
    expect(rec.expires_at).toBe(T0 + HOUR);
    expect(Arrays.equal(rec.scope!, SCOPE)).toBe(true);
  });

  it("reads never call the identity contract", () => {
    doCreate();
    MockVM.setCallContractResults([]);
    const before = MockVM.getCallContractArguments().length;
    community(COMMUNITY_ID);
    role(COMMUNITY_ID, BOB);
    contract.get_identity_contract(new communities.get_identity_contract_arguments());
    expect(MockVM.getCallContractArguments().length).toBe(before);
  });
});
