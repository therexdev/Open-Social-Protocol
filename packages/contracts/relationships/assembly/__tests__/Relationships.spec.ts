// Unit tests for the relationships contract (as-pect 8 + Koinos mock VM).
//
// Conventions: as-pect cannot reflect generated protobuf classes, so every
// assertion is on primitives; byte fields are compared with Arrays.equal.
// A revert rolls the mock database back to the last MockVM.commitTransaction(),
// so happy-path calls that later steps depend on are committed explicitly.
//
// The identity contract is stubbed: every System.call to identity.resolve_actor
// consumes one queued result (Testing.mockResolveActor / MockVM.setCallContractResults).
// request_friend and follow make two calls (actor resolution, then counterparty
// existence); every other mutating method makes exactly one.
import { Arrays, Base58, MockVM, Protobuf, chain, system_calls } from "@koinos/sdk-as";
import { Relationships } from "../Relationships";
import { relationships } from "../proto/relationships";
import { identity } from "../proto/identity";
import { Testing } from "../common/testing";
import { Util } from "../common/util";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTRACT_ID = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu");
const IDENTITY_CONTRACT = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK");
const ALICE = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe");
const BOB = Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH");
const CAROL = Base58.decode("161DDwJNQyHqYJbP4C7Y8BTULrkjgC4U6g");
const DEVICE = Base58.decode("1GXe3r3VmkKAEhj6C156jPxQC8p1xbQD2i");

const T0: u64 = Testing.DEFAULT_TIME;
const HOUR: u64 = 3_600_000;

const RESOLVE_ACTOR_ENTRY_POINT: u32 = 0x9f7b95a1;
const RELATIONSHIPS_CAPABILITY: u32 = 8;

const PENDING: i32 = 1;
const ACTIVE: i32 = 2;
const INACTIVE: i32 = 3;

const REF = filled(32, 0xaa);

let contract!: Relationships;

function filled(n: i32, v: u8): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = v;
  return out;
}

/** Lower / higher of two addresses in canonical pair order. */
function lower(a: Uint8Array, b: Uint8Array): Uint8Array {
  return Util.compare(a, b) < 0 ? a : b;
}
function higher(a: Uint8Array, b: Uint8Array): Uint8Array {
  return Util.compare(a, b) < 0 ? b : a;
}

// ---------------------------------------------------------------------------
// Mock VM helpers
// ---------------------------------------------------------------------------

function setup(): void {
  Testing.setup(CONTRACT_ID);
  // Testing.setup writes contract id / entry point / arguments after the mock
  // VM's reset commit; commit again so a revert cannot roll that metadata away.
  MockVM.commitTransaction();
  contract = new Relationships();
}

function configureIdentity(): void {
  Testing.authorize([CONTRACT_ID]);
  contract.set_identity_contract(new relationships.set_identity_contract_arguments(IDENTITY_CONTRACT));
  MockVM.commitTransaction();
}

function setupConfigured(): void {
  setup();
  configureIdentity();
}

/** A stubbed identity.resolve_actor answer. */
function resolved(ok: bool, signer: Uint8Array | null, reason: string | null): system_calls.exit_arguments {
  const res = new identity.resolve_actor_result(ok, signer, reason);
  const bytes = Protobuf.encode(res, identity.resolve_actor_result.encode);
  return new system_calls.exit_arguments(0, new chain.result(bytes));
}

function queue(results: system_calls.exit_arguments[]): void {
  MockVM.setCallContractResults(results);
}

/** Sign as `account` and resolve `calls` identity lookups to that same account (owner path). */
function asOwner(account: Uint8Array, calls: i32): void {
  Testing.authorize([account]);
  Testing.mockResolveActor(true, account, "", calls);
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

function eventAt(i: i32): system_calls.event_arguments {
  const events = MockVM.getEvents();
  expect(events.length > i).toBe(true, "event index out of range");
  return events[i];
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

/** Decode the resolve_actor arguments of the i-th cross-contract call made so far. */
function resolveCallAt(i: i32): identity.resolve_actor_arguments {
  const calls = MockVM.getCallContractArguments();
  expect(calls.length > i).toBe(true, "cross-contract call index out of range");
  const call = calls[i];
  expect(Arrays.equal(call.contract_id, IDENTITY_CONTRACT)).toBe(true, "call targets identity contract");
  expect(call.entry_point).toBe(RESOLVE_ACTOR_ENTRY_POINT, "call entry point");
  return Protobuf.decode<identity.resolve_actor_arguments>(call.args, identity.resolve_actor_arguments.decode);
}

// ---------------------------------------------------------------------------
// Contract call wrappers (module-level so they can be used inside closures)
// ---------------------------------------------------------------------------

function requestFriend(requester: Uint8Array, recipient: Uint8Array, device: Uint8Array | null = null): void {
  contract.request_friend(new relationships.request_friend_arguments(requester, recipient, device));
}

function acceptFriend(
  approver: Uint8Array,
  requester: Uint8Array,
  device: Uint8Array | null = null,
  ref: Uint8Array | null = null
): void {
  contract.accept_friend(new relationships.accept_friend_arguments(approver, requester, device, ref));
}

function removeFriend(actor: Uint8Array, peer: Uint8Array, device: Uint8Array | null = null): void {
  contract.remove_friend(new relationships.remove_friend_arguments(actor, peer, device));
}

function block(actor: Uint8Array, target: Uint8Array): void {
  contract.block(new relationships.block_arguments(actor, target));
}

function unblock(actor: Uint8Array, target: Uint8Array): void {
  contract.unblock(new relationships.unblock_arguments(actor, target));
}

function follow(follower: Uint8Array, target: Uint8Array, device: Uint8Array | null = null): void {
  contract.follow(new relationships.follow_arguments(follower, target, device));
}

function unfollow(follower: Uint8Array, target: Uint8Array, device: Uint8Array | null = null): void {
  contract.unfollow(new relationships.unfollow_arguments(follower, target, device));
}

function rotateAudience(actor: Uint8Array, device: Uint8Array | null = null): void {
  contract.rotate_audience(new relationships.rotate_audience_arguments(actor, device));
}

// Committed happy-path steps used as fixtures by later assertions.

function doRequest(requester: Uint8Array, recipient: Uint8Array): void {
  asOwner(requester, 2);
  requestFriend(requester, recipient);
  MockVM.commitTransaction();
}

function doAccept(approver: Uint8Array, requester: Uint8Array, ref: Uint8Array | null = null): void {
  asOwner(approver, 1);
  acceptFriend(approver, requester, null, ref);
  MockVM.commitTransaction();
}

function befriend(a: Uint8Array, b: Uint8Array): void {
  doRequest(a, b);
  doAccept(b, a);
}

function doRemove(actor: Uint8Array, peer: Uint8Array): void {
  asOwner(actor, 1);
  removeFriend(actor, peer);
  MockVM.commitTransaction();
}

function doBlock(actor: Uint8Array, target: Uint8Array): void {
  asOwner(actor, 1);
  block(actor, target);
  MockVM.commitTransaction();
}

function doUnblock(actor: Uint8Array, target: Uint8Array): void {
  asOwner(actor, 1);
  unblock(actor, target);
  MockVM.commitTransaction();
}

function doFollow(follower: Uint8Array, target: Uint8Array): void {
  asOwner(follower, 2);
  follow(follower, target);
  MockVM.commitTransaction();
}

function doUnfollow(follower: Uint8Array, target: Uint8Array): void {
  asOwner(follower, 1);
  unfollow(follower, target);
  MockVM.commitTransaction();
}

function doRotate(actor: Uint8Array): void {
  asOwner(actor, 1);
  rotateAudience(actor);
  MockVM.commitTransaction();
}

// Reads.

function rel(a: Uint8Array, b: Uint8Array): relationships.relationship_record | null {
  return contract.get_relationship(new relationships.get_relationship_arguments(a, b)).value;
}

function relOrFail(a: Uint8Array, b: Uint8Array): relationships.relationship_record {
  const rec = rel(a, b);
  expect(rec == null).toBe(false, "relationship record missing");
  return rec!;
}

function epochOf(account: Uint8Array): u32 {
  const state = contract.get_audience(new relationships.get_audience_arguments(account)).value;
  expect(state == null).toBe(false, "audience state must never be null");
  return state!.epoch;
}

function audienceUpdatedAt(account: Uint8Array): u64 {
  const state = contract.get_audience(new relationships.get_audience_arguments(account)).value;
  expect(state == null).toBe(false, "audience state must never be null");
  return state!.updated_at;
}

function isBlocked(actor: Uint8Array, target: Uint8Array): bool {
  return contract.is_blocked(new relationships.is_blocked_arguments(actor, target)).value;
}

function followOf(follower: Uint8Array, target: Uint8Array): relationships.follow_record | null {
  return contract.get_follow(new relationships.get_follow_arguments(follower, target)).value;
}

function isFollowing(follower: Uint8Array, target: Uint8Array): bool {
  const rec = followOf(follower, target);
  return rec != null && rec.active;
}

// ---------------------------------------------------------------------------
// Admin: set_identity_contract / get_identity_contract
// ---------------------------------------------------------------------------

describe("relationships: set_identity_contract", () => {
  beforeEach(() => {
    setup();
  });

  it("is unset by default", () => {
    const res = contract.get_identity_contract(new relationships.get_identity_contract_arguments());
    expect(res.value == null).toBe(true);
  });

  it("stores the identity contract when signed by the contract account", () => {
    Testing.authorize([CONTRACT_ID]);
    contract.set_identity_contract(new relationships.set_identity_contract_arguments(IDENTITY_CONTRACT));
    const res = contract.get_identity_contract(new relationships.get_identity_contract_arguments());
    expect(res.value == null).toBe(false);
    expect(Arrays.equal(res.value!, IDENTITY_CONTRACT)).toBe(true);
  });

  it("rejects a signer other than the contract account", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.set_identity_contract(new relationships.set_identity_contract_arguments(IDENTITY_CONTRACT));
    }).toThrow();
    expectRevert("authorization failed");
    expect(contract.get_identity_contract(new relationships.get_identity_contract_arguments()).value == null).toBe(true);
  });

  it("rejects a malformed address", () => {
    Testing.authorize([CONTRACT_ID]);
    expect(() => {
      contract.set_identity_contract(new relationships.set_identity_contract_arguments(filled(10, 1)));
    }).toThrow();
    expectRevert("address must be a 25-byte address");
    expect(() => {
      contract.set_identity_contract(new relationships.set_identity_contract_arguments(null));
    }).toThrow();
    expectRevert("address is required");
  });

  it("can be replaced by the contract account", () => {
    configureIdentity();
    Testing.authorize([CONTRACT_ID]);
    contract.set_identity_contract(new relationships.set_identity_contract_arguments(CAROL));
    const res = contract.get_identity_contract(new relationships.get_identity_contract_arguments());
    expect(Arrays.equal(res.value!, CAROL)).toBe(true);
  });

  it("write methods revert while the identity contract is not configured", () => {
    asOwner(ALICE, 2);
    expect(() => {
      requestFriend(ALICE, BOB);
    }).toThrow();
    expectRevert("identity contract not configured");
    expect(() => {
      block(ALICE, BOB);
    }).toThrow();
    expectRevert("identity contract not configured");
    expect(() => {
      follow(ALICE, BOB);
    }).toThrow();
    expectRevert("identity contract not configured");
    expect(() => {
      rotateAudience(ALICE);
    }).toThrow();
    expectRevert("identity contract not configured");
  });
});

// ---------------------------------------------------------------------------
// request_friend
// ---------------------------------------------------------------------------

describe("relationships: request_friend", () => {
  beforeEach(() => {
    setupConfigured();
  });

  it("creates a pending edge and emits osp.relationships.friend_requested", () => {
    asOwner(ALICE, 2);
    requestFriend(ALICE, BOB);

    const rec = relOrFail(ALICE, BOB);
    expect(Arrays.equal(rec.a!, lower(ALICE, BOB))).toBe(true, "a is the lower address");
    expect(Arrays.equal(rec.b!, higher(ALICE, BOB))).toBe(true, "b is the higher address");
    expect(<i32>rec.status).toBe(PENDING);
    expect(Arrays.equal(rec.requester!, ALICE)).toBe(true);
    expect(rec.nonce).toBe(1);
    expect(rec.updated_at).toBe(T0);

    // Same record from either argument order.
    const mirrored = relOrFail(BOB, ALICE);
    expect(mirrored.nonce).toBe(1);
    expect(<i32>mirrored.status).toBe(PENDING);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.relationships.friend_requested");
    expectImpacted(ev, [ALICE, BOB]);
    const data = Protobuf.decode<relationships.friend_requested_event>(ev.data, relationships.friend_requested_event.decode);
    expect(Arrays.equal(data.requester!, ALICE)).toBe(true);
    expect(Arrays.equal(data.recipient!, BOB)).toBe(true);
    expect(data.nonce).toBe(1);
    expect(data.timestamp).toBe(T0);

    // Resolution: requester with the RELATIONSHIPS capability, then recipient existence.
    const first = resolveCallAt(0);
    expect(Arrays.equal(first.account!, ALICE)).toBe(true);
    expect(first.device == null || first.device!.length == 0).toBe(true);
    expect(first.capability).toBe(RELATIONSHIPS_CAPABILITY);
    const second = resolveCallAt(1);
    expect(Arrays.equal(second.account!, BOB)).toBe(true);
    expect(second.capability).toBe(0);
  });

  it("rejects a request to yourself before touching the identity contract", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      requestFriend(ALICE, ALICE);
    }).toThrow();
    expectRevert("cannot friend yourself");
    expect(rel(ALICE, ALICE) == null).toBe(true);
  });

  it("rejects malformed addresses", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      requestFriend(filled(3, 1), BOB);
    }).toThrow();
    expectRevert("requester must be a 25-byte address");
    expect(() => {
      contract.request_friend(new relationships.request_friend_arguments(ALICE, null, null));
    }).toThrow();
    expectRevert("recipient is required");
  });

  it("rejects a duplicate request from either side while pending", () => {
    doRequest(ALICE, BOB);
    asOwner(ALICE, 2);
    expect(() => {
      requestFriend(ALICE, BOB);
    }).toThrow();
    expectRevert("already pending");
    asOwner(BOB, 2);
    expect(() => {
      requestFriend(BOB, ALICE);
    }).toThrow();
    expectRevert("already pending");
    expect(relOrFail(ALICE, BOB).nonce).toBe(1);
  });

  it("rejects a request when already friends", () => {
    befriend(ALICE, BOB);
    asOwner(BOB, 2);
    expect(() => {
      requestFriend(BOB, ALICE);
    }).toThrow();
    expectRevert("already friends");
    expect(<i32>relOrFail(ALICE, BOB).status).toBe(ACTIVE);
  });

  it("rejects an unregistered requester", () => {
    Testing.authorize([ALICE]);
    Testing.mockResolveActor(false, null, "unregistered", 1);
    expect(() => {
      requestFriend(ALICE, BOB);
    }).toThrow();
    expectRevert("unregistered");
    expect(rel(ALICE, BOB) == null).toBe(true);
  });

  it("rejects an unregistered recipient", () => {
    Testing.authorize([ALICE]);
    queue([resolved(true, ALICE, null), resolved(false, null, "unregistered")]);
    expect(() => {
      requestFriend(ALICE, BOB);
    }).toThrow();
    expectRevert("recipient not registered");
    expect(rel(ALICE, BOB) == null).toBe(true);
  });

  it("rejects a transaction not signed by the resolved signer", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "", 2);
    expect(() => {
      requestFriend(ALICE, BOB);
    }).toThrow();
    expectRevert("authorization failed");
    expect(rel(ALICE, BOB) == null).toBe(true);
  });

  it("accepts a device signer holding the relationships capability", () => {
    Testing.authorize([DEVICE]);
    Testing.mockResolveActor(true, DEVICE, "", 2);
    requestFriend(ALICE, BOB, DEVICE);
    expect(<i32>relOrFail(ALICE, BOB).status).toBe(PENDING);
    const call = resolveCallAt(0);
    expect(Arrays.equal(call.account!, ALICE)).toBe(true);
    expect(Arrays.equal(call.device!, DEVICE)).toBe(true);
    expect(call.capability).toBe(RELATIONSHIPS_CAPABILITY);
  });

  it("rejects a device signer that did not sign", () => {
    Testing.authorize([ALICE]);
    Testing.mockResolveActor(true, DEVICE, "", 2);
    expect(() => {
      requestFriend(ALICE, BOB, DEVICE);
    }).toThrow();
    expectRevert("authorization failed");
  });

  it("propagates the identity contract's rejection of a device", () => {
    Testing.authorize([DEVICE]);
    Testing.mockResolveActor(false, null, "capability not granted", 1);
    expect(() => {
      requestFriend(ALICE, BOB, DEVICE);
    }).toThrow();
    expectRevert("capability not granted");
  });

  it("rejects a request when the requester blocked the recipient", () => {
    doBlock(ALICE, BOB);
    asOwner(ALICE, 2);
    expect(() => {
      requestFriend(ALICE, BOB);
    }).toThrow();
    expectRevert("recipient is blocked");
    expect(rel(ALICE, BOB) == null).toBe(true);
  });

  it("rejects a request when the recipient blocked the requester", () => {
    doBlock(BOB, ALICE);
    asOwner(ALICE, 2);
    expect(() => {
      requestFriend(ALICE, BOB);
    }).toThrow();
    expectRevert("blocked by recipient");
    expect(rel(ALICE, BOB) == null).toBe(true);
  });

  it("re-requests an inactive edge and continues the nonce", () => {
    befriend(ALICE, BOB); // nonce 2
    doRemove(ALICE, BOB); // nonce 3
    expect(<i32>relOrFail(ALICE, BOB).status).toBe(INACTIVE);

    // The former recipient can now be the requester.
    doRequest(BOB, ALICE);
    const rec = relOrFail(ALICE, BOB);
    expect(<i32>rec.status).toBe(PENDING);
    expect(rec.nonce).toBe(4);
    expect(Arrays.equal(rec.requester!, BOB)).toBe(true);
    expect(Arrays.equal(rec.a!, lower(ALICE, BOB))).toBe(true);
    expect(Arrays.equal(rec.b!, higher(ALICE, BOB))).toBe(true);

    const data = Protobuf.decode<relationships.friend_requested_event>(lastEvent().data, relationships.friend_requested_event.decode);
    expect(data.nonce).toBe(4);
    expect(Arrays.equal(data.requester!, BOB)).toBe(true);
  });

  it("keeps pairs independent", () => {
    doRequest(ALICE, BOB);
    doRequest(ALICE, CAROL);
    expect(relOrFail(ALICE, BOB).nonce).toBe(1);
    expect(relOrFail(ALICE, CAROL).nonce).toBe(1);
    expect(rel(BOB, CAROL) == null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// accept_friend
// ---------------------------------------------------------------------------

describe("relationships: accept_friend", () => {
  beforeEach(() => {
    setupConfigured();
    doRequest(ALICE, BOB);
  });

  it("activates the edge, bumps the nonce and emits osp.relationships.friend_accepted", () => {
    Testing.setTime(T0 + HOUR);
    asOwner(BOB, 1);
    acceptFriend(BOB, ALICE, null, REF);

    const rec = relOrFail(ALICE, BOB);
    expect(<i32>rec.status).toBe(ACTIVE);
    expect(rec.nonce).toBe(2);
    expect(Arrays.equal(rec.requester!, ALICE)).toBe(true, "requester is preserved");
    expect(rec.updated_at).toBe(T0 + HOUR);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.relationships.friend_accepted");
    expectImpacted(ev, [BOB, ALICE]);
    const data = Protobuf.decode<relationships.friend_accepted_event>(ev.data, relationships.friend_accepted_event.decode);
    expect(Arrays.equal(data.approver!, BOB)).toBe(true);
    expect(Arrays.equal(data.requester!, ALICE)).toBe(true);
    expect(data.nonce).toBe(2);
    expect(Arrays.equal(data.key_package_ref!, REF)).toBe(true);
    expect(data.timestamp).toBe(T0 + HOUR);

    // No epoch change on accept.
    expect(epochOf(ALICE)).toBe(0);
    expect(epochOf(BOB)).toBe(0);

    const call = resolveCallAt(2);
    expect(Arrays.equal(call.account!, BOB)).toBe(true);
    expect(call.capability).toBe(RELATIONSHIPS_CAPABILITY);
  });

  it("accepts an empty key_package_ref", () => {
    asOwner(BOB, 1);
    acceptFriend(BOB, ALICE, null, new Uint8Array(0));
    const data = Protobuf.decode<relationships.friend_accepted_event>(lastEvent().data, relationships.friend_accepted_event.decode);
    expect(data.key_package_ref == null || data.key_package_ref!.length == 0).toBe(true);
    expect(<i32>relOrFail(ALICE, BOB).status).toBe(ACTIVE);
  });

  it("rejects a key_package_ref that is neither empty nor 32 bytes", () => {
    asOwner(BOB, 1);
    expect(() => {
      acceptFriend(BOB, ALICE, null, filled(31, 1));
    }).toThrow();
    expectRevert("key_package_ref must be empty or 32 bytes");
    expect(<i32>relOrFail(ALICE, BOB).status).toBe(PENDING);
  });

  it("rejects acceptance by the requester", () => {
    asOwner(ALICE, 1);
    expect(() => {
      acceptFriend(ALICE, BOB);
    }).toThrow();
    expectRevert("requester mismatch");
    expect(<i32>relOrFail(ALICE, BOB).status).toBe(PENDING);
  });

  it("rejects acceptance by a third party", () => {
    asOwner(CAROL, 1);
    expect(() => {
      acceptFriend(CAROL, ALICE);
    }).toThrow();
    expectRevert("no pending request");
    expect(<i32>relOrFail(ALICE, BOB).status).toBe(PENDING);
  });

  it("rejects approver == requester", () => {
    asOwner(BOB, 1);
    expect(() => {
      acceptFriend(BOB, BOB);
    }).toThrow();
    expectRevert("approver and requester must differ");
  });

  it("rejects acceptance when nothing is pending", () => {
    asOwner(CAROL, 1);
    expect(() => {
      acceptFriend(CAROL, BOB);
    }).toThrow();
    expectRevert("no pending request");

    doAccept(BOB, ALICE);
    asOwner(BOB, 1);
    expect(() => {
      acceptFriend(BOB, ALICE);
    }).toThrow();
    expectRevert("no pending request");
    expect(relOrFail(ALICE, BOB).nonce).toBe(2);
  });

  it("rejects an approver that did not sign", () => {
    Testing.authorize([ALICE]);
    Testing.mockResolveActor(true, BOB, "", 1);
    expect(() => {
      acceptFriend(BOB, ALICE);
    }).toThrow();
    expectRevert("authorization failed");
    expect(<i32>relOrFail(ALICE, BOB).status).toBe(PENDING);
  });

  it("accepts through a device with the relationships capability", () => {
    Testing.authorize([DEVICE]);
    Testing.mockResolveActor(true, DEVICE, "", 1);
    acceptFriend(BOB, ALICE, DEVICE, REF);
    expect(<i32>relOrFail(ALICE, BOB).status).toBe(ACTIVE);
    const call = resolveCallAt(2);
    expect(Arrays.equal(call.account!, BOB)).toBe(true);
    expect(Arrays.equal(call.device!, DEVICE)).toBe(true);
    expect(call.capability).toBe(RELATIONSHIPS_CAPABILITY);
  });
});

// ---------------------------------------------------------------------------
// remove_friend
// ---------------------------------------------------------------------------

describe("relationships: remove_friend", () => {
  beforeEach(() => {
    setupConfigured();
    befriend(ALICE, BOB);
  });

  it("deactivates the edge, advances the actor epoch and emits friend_removed + audience_rotated", () => {
    Testing.setTime(T0 + HOUR);
    const before = eventCount();
    asOwner(ALICE, 1);
    removeFriend(ALICE, BOB);

    const rec = relOrFail(ALICE, BOB);
    expect(<i32>rec.status).toBe(INACTIVE);
    expect(rec.nonce).toBe(3);
    expect(rec.updated_at).toBe(T0 + HOUR);

    expect(epochOf(ALICE)).toBe(1);
    expect(audienceUpdatedAt(ALICE)).toBe(T0 + HOUR);
    expect(epochOf(BOB)).toBe(0, "peer epoch unchanged");

    expect(eventCount()).toBe(before + 2);
    const removedEv = eventAt(before);
    expect(removedEv.name).toBe("osp.relationships.friend_removed");
    expectImpacted(removedEv, [ALICE, BOB]);
    const removed = Protobuf.decode<relationships.friend_removed_event>(removedEv.data, relationships.friend_removed_event.decode);
    expect(Arrays.equal(removed.actor!, ALICE)).toBe(true);
    expect(Arrays.equal(removed.peer!, BOB)).toBe(true);
    expect(removed.nonce).toBe(3);
    expect(removed.new_epoch).toBe(1);
    expect(removed.timestamp).toBe(T0 + HOUR);

    const rotatedEv = eventAt(before + 1);
    expect(rotatedEv.name).toBe("osp.relationships.audience_rotated");
    expectImpacted(rotatedEv, [ALICE]);
    const rotated = Protobuf.decode<relationships.audience_rotated_event>(rotatedEv.data, relationships.audience_rotated_event.decode);
    expect(Arrays.equal(rotated.account!, ALICE)).toBe(true);
    expect(rotated.new_epoch).toBe(1);
    expect(rotated.reason!).toBe("friend_removed");
    expect(rotated.timestamp).toBe(T0 + HOUR);
  });

  it("can be called by the peer (the original recipient)", () => {
    asOwner(BOB, 1);
    removeFriend(BOB, ALICE);
    expect(<i32>relOrFail(ALICE, BOB).status).toBe(INACTIVE);
    expect(epochOf(BOB)).toBe(1);
    expect(epochOf(ALICE)).toBe(0);
  });

  it("rejects removal when the edge is not active", () => {
    doRemove(ALICE, BOB);
    asOwner(BOB, 1);
    expect(() => {
      removeFriend(BOB, ALICE);
    }).toThrow();
    expectRevert("not friends");
    expect(relOrFail(ALICE, BOB).nonce).toBe(3);
    expect(epochOf(BOB)).toBe(0);

    // Pending edges cannot be removed either.
    doRequest(ALICE, CAROL);
    asOwner(ALICE, 1);
    expect(() => {
      removeFriend(ALICE, CAROL);
    }).toThrow();
    expectRevert("not friends");

    // Unknown pairs.
    asOwner(BOB, 1);
    expect(() => {
      removeFriend(BOB, CAROL);
    }).toThrow();
    expectRevert("not friends");
  });

  it("rejects actor == peer", () => {
    asOwner(ALICE, 1);
    expect(() => {
      removeFriend(ALICE, ALICE);
    }).toThrow();
    expectRevert("actor and peer must differ");
  });

  it("rejects an actor that did not sign", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "", 1);
    expect(() => {
      removeFriend(ALICE, BOB);
    }).toThrow();
    expectRevert("authorization failed");
    expect(<i32>relOrFail(ALICE, BOB).status).toBe(ACTIVE);
    expect(epochOf(ALICE)).toBe(0);
  });

  it("advances the epoch once per removal across friendships", () => {
    befriend(ALICE, CAROL);
    doRemove(ALICE, BOB);
    expect(epochOf(ALICE)).toBe(1);
    clearEvents();
    doRemove(ALICE, CAROL);
    expect(epochOf(ALICE)).toBe(2);
    expect(relOrFail(ALICE, CAROL).nonce).toBe(3);
    const rotated = Protobuf.decode<relationships.audience_rotated_event>(lastEvent().data, relationships.audience_rotated_event.decode);
    expect(rotated.new_epoch).toBe(2);
    expect(rotated.reason!).toBe("friend_removed");
  });

  it("removal followed by a new request and acceptance keeps counting the nonce", () => {
    doRemove(ALICE, BOB); // 3
    doRequest(ALICE, BOB); // 4
    doAccept(BOB, ALICE); // 5
    const rec = relOrFail(ALICE, BOB);
    expect(<i32>rec.status).toBe(ACTIVE);
    expect(rec.nonce).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// block / unblock
// ---------------------------------------------------------------------------

describe("relationships: block", () => {
  beforeEach(() => {
    setupConfigured();
  });

  it("ends the friendship, clears follows both ways, advances the epoch and emits blocked + audience_rotated", () => {
    befriend(ALICE, BOB); // nonce 2
    doFollow(ALICE, BOB);
    doFollow(BOB, ALICE);
    doFollow(BOB, CAROL);
    expect(isFollowing(ALICE, BOB)).toBe(true);
    expect(isFollowing(BOB, ALICE)).toBe(true);

    Testing.setTime(T0 + HOUR);
    clearEvents();
    const before = eventCount();
    asOwner(ALICE, 1);
    block(ALICE, BOB);

    expect(isBlocked(ALICE, BOB)).toBe(true);
    expect(isBlocked(BOB, ALICE)).toBe(false, "blocks are directional");

    const rec = relOrFail(ALICE, BOB);
    expect(<i32>rec.status).toBe(INACTIVE);
    expect(rec.nonce).toBe(3);
    expect(rec.updated_at).toBe(T0 + HOUR);

    expect(followOf(ALICE, BOB) == null).toBe(true, "actor -> target follow deleted");
    expect(followOf(BOB, ALICE) == null).toBe(true, "target -> actor follow deleted");
    expect(isFollowing(BOB, CAROL)).toBe(true, "unrelated follows untouched");

    expect(epochOf(ALICE)).toBe(1);
    expect(epochOf(BOB)).toBe(0);

    expect(eventCount()).toBe(before + 2, "exactly blocked + audience_rotated");
    const blockedEv = eventAt(before);
    expect(blockedEv.name).toBe("osp.relationships.blocked");
    expectImpacted(blockedEv, [ALICE, BOB]);
    const blocked = Protobuf.decode<relationships.blocked_event>(blockedEv.data, relationships.blocked_event.decode);
    expect(Arrays.equal(blocked.actor!, ALICE)).toBe(true);
    expect(Arrays.equal(blocked.target!, BOB)).toBe(true);
    expect(blocked.new_epoch).toBe(1);
    expect(blocked.timestamp).toBe(T0 + HOUR);

    const rotatedEv = eventAt(before + 1);
    expect(rotatedEv.name).toBe("osp.relationships.audience_rotated");
    expectImpacted(rotatedEv, [ALICE]);
    const rotated = Protobuf.decode<relationships.audience_rotated_event>(rotatedEv.data, relationships.audience_rotated_event.decode);
    expect(rotated.new_epoch).toBe(1);
    expect(rotated.reason!).toBe("blocked");

    // No friend_removed event is emitted by block.
    const names = Testing.eventNames();
    let removedEvents = 0;
    for (let i = before; i < names.length; i++) {
      if (names[i] == "osp.relationships.friend_removed") removedEvents += 1;
    }
    expect(removedEvents).toBe(0);
  });

  it("resolves the actor as owner only (no device, capability 0)", () => {
    asOwner(ALICE, 1);
    block(ALICE, BOB);
    const call = resolveCallAt(0);
    expect(Arrays.equal(call.account!, ALICE)).toBe(true);
    expect(call.device == null || call.device!.length == 0).toBe(true, "no device on block");
    expect(call.capability).toBe(0);
  });

  it("turns a pending edge inactive", () => {
    doRequest(BOB, ALICE);
    doBlock(ALICE, BOB);
    const rec = relOrFail(ALICE, BOB);
    expect(<i32>rec.status).toBe(INACTIVE);
    expect(rec.nonce).toBe(2);
    expect(epochOf(ALICE)).toBe(1);
  });

  it("does not create a relationship record when there was no edge", () => {
    doBlock(ALICE, BOB);
    expect(rel(ALICE, BOB) == null).toBe(true);
    expect(isBlocked(ALICE, BOB)).toBe(true);
    expect(epochOf(ALICE)).toBe(1);
  });

  it("leaves an already inactive edge's nonce untouched", () => {
    befriend(ALICE, BOB); // 2
    doRemove(BOB, ALICE); // 3
    doBlock(ALICE, BOB);
    expect(relOrFail(ALICE, BOB).nonce).toBe(3);
    expect(epochOf(ALICE)).toBe(1);
  });

  it("rejects blocking yourself", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      block(ALICE, ALICE);
    }).toThrow();
    expectRevert("cannot block yourself");
    expect(isBlocked(ALICE, ALICE)).toBe(false);
  });

  it("rejects blocking twice", () => {
    doBlock(ALICE, BOB);
    asOwner(ALICE, 1);
    expect(() => {
      block(ALICE, BOB);
    }).toThrow();
    expectRevert("already blocked");
    expect(epochOf(ALICE)).toBe(1, "no extra epoch bump");
  });

  it("rejects an actor that did not sign", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "", 1);
    expect(() => {
      block(ALICE, BOB);
    }).toThrow();
    expectRevert("authorization failed");
    expect(isBlocked(ALICE, BOB)).toBe(false);
    expect(epochOf(ALICE)).toBe(0);
  });

  it("rejects an unregistered actor", () => {
    Testing.authorize([ALICE]);
    Testing.mockResolveActor(false, null, "unregistered", 1);
    expect(() => {
      block(ALICE, BOB);
    }).toThrow();
    expectRevert("unregistered");
  });

  it("rejects malformed addresses", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      block(ALICE, filled(25, 0).subarray(0, 5));
    }).toThrow();
    expectRevert("target must be a 25-byte address");
  });

  it("blocked pairs cannot request or follow in either direction", () => {
    doBlock(ALICE, BOB);

    asOwner(ALICE, 2);
    expect(() => {
      requestFriend(ALICE, BOB);
    }).toThrow();
    expectRevert("recipient is blocked");

    asOwner(BOB, 2);
    expect(() => {
      requestFriend(BOB, ALICE);
    }).toThrow();
    expectRevert("blocked by recipient");

    asOwner(ALICE, 2);
    expect(() => {
      follow(ALICE, BOB);
    }).toThrow();
    expectRevert("target is blocked");

    asOwner(BOB, 2);
    expect(() => {
      follow(BOB, ALICE);
    }).toThrow();
    expectRevert("blocked by target");

    expect(rel(ALICE, BOB) == null).toBe(true);
    expect(followOf(ALICE, BOB) == null).toBe(true);
    expect(followOf(BOB, ALICE) == null).toBe(true);
  });

  it("a block does not prevent relationships with third parties", () => {
    doBlock(ALICE, BOB);
    doRequest(ALICE, CAROL);
    doFollow(BOB, CAROL);
    expect(<i32>relOrFail(ALICE, CAROL).status).toBe(PENDING);
    expect(isFollowing(BOB, CAROL)).toBe(true);
  });
});

describe("relationships: unblock", () => {
  beforeEach(() => {
    setupConfigured();
    befriend(ALICE, BOB);
    doBlock(ALICE, BOB);
  });

  it("removes the block and emits osp.relationships.unblocked", () => {
    Testing.setTime(T0 + HOUR);
    const before = eventCount();
    asOwner(ALICE, 1);
    unblock(ALICE, BOB);

    expect(isBlocked(ALICE, BOB)).toBe(false);
    expect(eventCount()).toBe(before + 1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.relationships.unblocked");
    expectImpacted(ev, [ALICE, BOB]);
    const data = Protobuf.decode<relationships.unblocked_event>(ev.data, relationships.unblocked_event.decode);
    expect(Arrays.equal(data.actor!, ALICE)).toBe(true);
    expect(Arrays.equal(data.target!, BOB)).toBe(true);
    expect(data.timestamp).toBe(T0 + HOUR);

    // Unblocking never rotates the epoch and never restores the friendship.
    expect(epochOf(ALICE)).toBe(1);
    expect(<i32>relOrFail(ALICE, BOB).status).toBe(INACTIVE);

    const call = resolveCallAt(MockVM.getCallContractArguments().length - 1);
    expect(call.device == null || call.device!.length == 0).toBe(true, "no device on unblock");
    expect(call.capability).toBe(0);
  });

  it("allows a new request after unblocking, continuing the nonce", () => {
    doUnblock(ALICE, BOB);
    doRequest(BOB, ALICE);
    const rec = relOrFail(ALICE, BOB);
    expect(<i32>rec.status).toBe(PENDING);
    expect(rec.nonce).toBe(4);
    expect(Arrays.equal(rec.requester!, BOB)).toBe(true);
    doAccept(ALICE, BOB);
    expect(<i32>relOrFail(ALICE, BOB).status).toBe(ACTIVE);
    expect(relOrFail(ALICE, BOB).nonce).toBe(5);
    doFollow(ALICE, BOB);
    expect(isFollowing(ALICE, BOB)).toBe(true);
  });

  it("rejects unblocking when not blocked", () => {
    asOwner(BOB, 1);
    expect(() => {
      unblock(BOB, ALICE);
    }).toThrow();
    expectRevert("not blocked");

    doUnblock(ALICE, BOB);
    asOwner(ALICE, 1);
    expect(() => {
      unblock(ALICE, BOB);
    }).toThrow();
    expectRevert("not blocked");
  });

  it("rejects unblocking yourself", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      unblock(ALICE, ALICE);
    }).toThrow();
    expectRevert("cannot unblock yourself");
  });

  it("rejects an actor that did not sign", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "", 1);
    expect(() => {
      unblock(ALICE, BOB);
    }).toThrow();
    expectRevert("authorization failed");
    expect(isBlocked(ALICE, BOB)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// follow / unfollow
// ---------------------------------------------------------------------------

describe("relationships: follow", () => {
  beforeEach(() => {
    setupConfigured();
  });

  it("creates an active follow and emits osp.relationships.followed", () => {
    Testing.setTime(T0 + HOUR);
    asOwner(ALICE, 2);
    follow(ALICE, BOB);

    const rec = followOf(ALICE, BOB);
    expect(rec == null).toBe(false);
    expect(rec!.active).toBe(true);
    expect(rec!.updated_at).toBe(T0 + HOUR);
    expect(followOf(BOB, ALICE) == null).toBe(true, "follows are unilateral");
    expect(rel(ALICE, BOB) == null).toBe(true, "follows do not create friendships");

    const ev = lastEvent();
    expect(ev.name).toBe("osp.relationships.followed");
    expectImpacted(ev, [ALICE, BOB]);
    const data = Protobuf.decode<relationships.followed_event>(ev.data, relationships.followed_event.decode);
    expect(Arrays.equal(data.follower!, ALICE)).toBe(true);
    expect(Arrays.equal(data.target!, BOB)).toBe(true);
    expect(data.timestamp).toBe(T0 + HOUR);

    const first = resolveCallAt(0);
    expect(Arrays.equal(first.account!, ALICE)).toBe(true);
    expect(first.capability).toBe(RELATIONSHIPS_CAPABILITY);
    const second = resolveCallAt(1);
    expect(Arrays.equal(second.account!, BOB)).toBe(true);
    expect(second.capability).toBe(0);
  });

  it("rejects following yourself", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      follow(ALICE, ALICE);
    }).toThrow();
    expectRevert("cannot follow yourself");
  });

  it("rejects following twice", () => {
    doFollow(ALICE, BOB);
    asOwner(ALICE, 2);
    expect(() => {
      follow(ALICE, BOB);
    }).toThrow();
    expectRevert("already following");
  });

  it("rejects an unregistered target", () => {
    Testing.authorize([ALICE]);
    queue([resolved(true, ALICE, null), resolved(false, null, "unregistered")]);
    expect(() => {
      follow(ALICE, BOB);
    }).toThrow();
    expectRevert("target not registered");
    expect(followOf(ALICE, BOB) == null).toBe(true);
  });

  it("rejects a follower that did not sign", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "", 2);
    expect(() => {
      follow(ALICE, BOB);
    }).toThrow();
    expectRevert("authorization failed");
    expect(followOf(ALICE, BOB) == null).toBe(true);
  });

  it("accepts a device signer with the relationships capability", () => {
    Testing.authorize([DEVICE]);
    Testing.mockResolveActor(true, DEVICE, "", 2);
    follow(ALICE, BOB, DEVICE);
    expect(isFollowing(ALICE, BOB)).toBe(true);
    const call = resolveCallAt(0);
    expect(Arrays.equal(call.device!, DEVICE)).toBe(true);
    expect(call.capability).toBe(RELATIONSHIPS_CAPABILITY);
  });

  it("rejects following when either side blocked the other", () => {
    doBlock(BOB, ALICE);
    asOwner(ALICE, 2);
    expect(() => {
      follow(ALICE, BOB);
    }).toThrow();
    expectRevert("blocked by target");

    doBlock(ALICE, CAROL);
    asOwner(ALICE, 2);
    expect(() => {
      follow(ALICE, CAROL);
    }).toThrow();
    expectRevert("target is blocked");
  });

  it("can be re-established after an unfollow", () => {
    doFollow(ALICE, BOB);
    doUnfollow(ALICE, BOB);
    doFollow(ALICE, BOB);
    expect(isFollowing(ALICE, BOB)).toBe(true);
  });
});

describe("relationships: unfollow", () => {
  beforeEach(() => {
    setupConfigured();
    doFollow(ALICE, BOB);
  });

  it("deletes the follow and emits osp.relationships.unfollowed", () => {
    Testing.setTime(T0 + HOUR);
    asOwner(ALICE, 1);
    unfollow(ALICE, BOB);

    expect(followOf(ALICE, BOB) == null).toBe(true);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.relationships.unfollowed");
    expectImpacted(ev, [ALICE, BOB]);
    const data = Protobuf.decode<relationships.unfollowed_event>(ev.data, relationships.unfollowed_event.decode);
    expect(Arrays.equal(data.follower!, ALICE)).toBe(true);
    expect(Arrays.equal(data.target!, BOB)).toBe(true);
    expect(data.timestamp).toBe(T0 + HOUR);

    const call = resolveCallAt(2);
    expect(Arrays.equal(call.account!, ALICE)).toBe(true);
    expect(call.capability).toBe(RELATIONSHIPS_CAPABILITY);
  });

  it("rejects unfollowing when not following", () => {
    asOwner(BOB, 1);
    expect(() => {
      unfollow(BOB, ALICE);
    }).toThrow();
    expectRevert("not following");

    doUnfollow(ALICE, BOB);
    asOwner(ALICE, 1);
    expect(() => {
      unfollow(ALICE, BOB);
    }).toThrow();
    expectRevert("not following");
  });

  it("rejects unfollowing yourself", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      unfollow(ALICE, ALICE);
    }).toThrow();
    expectRevert("cannot unfollow yourself");
  });

  it("rejects a follower that did not sign", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "", 1);
    expect(() => {
      unfollow(ALICE, BOB);
    }).toThrow();
    expectRevert("authorization failed");
    expect(isFollowing(ALICE, BOB)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rotate_audience / get_audience
// ---------------------------------------------------------------------------

describe("relationships: rotate_audience", () => {
  beforeEach(() => {
    setupConfigured();
  });

  it("get_audience returns epoch 0 (never null) for unknown accounts", () => {
    const res = contract.get_audience(new relationships.get_audience_arguments(ALICE));
    expect(res.value == null).toBe(false);
    expect(res.value!.epoch).toBe(0);
    expect(res.value!.updated_at).toBe(0);
    const empty = contract.get_audience(new relationships.get_audience_arguments(null));
    expect(empty.value == null).toBe(false);
    expect(empty.value!.epoch).toBe(0);
  });

  it("advances the epoch and emits audience_rotated with reason manual", () => {
    Testing.setTime(T0 + HOUR);
    asOwner(ALICE, 1);
    rotateAudience(ALICE);
    expect(epochOf(ALICE)).toBe(1);
    expect(audienceUpdatedAt(ALICE)).toBe(T0 + HOUR);

    const ev = lastEvent();
    expect(ev.name).toBe("osp.relationships.audience_rotated");
    expectImpacted(ev, [ALICE]);
    const data = Protobuf.decode<relationships.audience_rotated_event>(ev.data, relationships.audience_rotated_event.decode);
    expect(Arrays.equal(data.account!, ALICE)).toBe(true);
    expect(data.new_epoch).toBe(1);
    expect(data.reason!).toBe("manual");
    expect(data.timestamp).toBe(T0 + HOUR);

    Testing.setTime(T0 + 2 * HOUR);
    asOwner(ALICE, 1);
    rotateAudience(ALICE);
    expect(epochOf(ALICE)).toBe(2);
    expect(audienceUpdatedAt(ALICE)).toBe(T0 + 2 * HOUR);
    expect(epochOf(BOB)).toBe(0);

    const call = resolveCallAt(0);
    expect(Arrays.equal(call.account!, ALICE)).toBe(true);
    expect(call.capability).toBe(RELATIONSHIPS_CAPABILITY);
  });

  it("composes with friend removal and blocks", () => {
    doRotate(ALICE); // 1
    befriend(ALICE, BOB);
    doRemove(ALICE, BOB); // 2
    doBlock(ALICE, CAROL); // 3
    clearEvents();
    doRotate(ALICE); // 4
    expect(epochOf(ALICE)).toBe(4);
    const data = Protobuf.decode<relationships.audience_rotated_event>(lastEvent().data, relationships.audience_rotated_event.decode);
    expect(data.new_epoch).toBe(4);
    expect(data.reason!).toBe("manual");
  });

  it("accepts a device signer with the relationships capability", () => {
    Testing.authorize([DEVICE]);
    Testing.mockResolveActor(true, DEVICE, "", 1);
    rotateAudience(ALICE, DEVICE);
    expect(epochOf(ALICE)).toBe(1);
    const call = resolveCallAt(0);
    expect(Arrays.equal(call.device!, DEVICE)).toBe(true);
    expect(call.capability).toBe(RELATIONSHIPS_CAPABILITY);
  });

  it("rejects an actor that did not sign", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "", 1);
    expect(() => {
      rotateAudience(ALICE);
    }).toThrow();
    expectRevert("authorization failed");
    expect(epochOf(ALICE)).toBe(0);
  });

  it("rejects an unresolved actor", () => {
    Testing.authorize([ALICE]);
    Testing.mockResolveActor(false, null, "device expired", 1);
    expect(() => {
      rotateAudience(ALICE, DEVICE);
    }).toThrow();
    expectRevert("device expired");
    expect(epochOf(ALICE)).toBe(0);
  });

  it("rejects a malformed actor", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      rotateAudience(filled(24, 1));
    }).toThrow();
    expectRevert("actor must be a 25-byte address");
  });
});

// ---------------------------------------------------------------------------
// Read methods
// ---------------------------------------------------------------------------

describe("relationships: reads", () => {
  beforeEach(() => {
    setupConfigured();
  });

  it("get_relationship returns null when missing or for empty arguments", () => {
    expect(rel(ALICE, BOB) == null).toBe(true);
    expect(contract.get_relationship(new relationships.get_relationship_arguments(null, BOB)).value == null).toBe(true);
    expect(contract.get_relationship(new relationships.get_relationship_arguments(ALICE, null)).value == null).toBe(true);
    expect(contract.get_relationship(new relationships.get_relationship_arguments(new Uint8Array(0), BOB)).value == null).toBe(true);
  });

  it("is_blocked is false when unknown or for empty arguments", () => {
    expect(isBlocked(ALICE, BOB)).toBe(false);
    expect(contract.is_blocked(new relationships.is_blocked_arguments(null, BOB)).value).toBe(false);
    expect(contract.is_blocked(new relationships.is_blocked_arguments(ALICE, null)).value).toBe(false);
    doBlock(ALICE, BOB);
    expect(isBlocked(ALICE, BOB)).toBe(true);
    expect(isBlocked(BOB, ALICE)).toBe(false);
  });

  it("get_follow returns null when missing or for empty arguments", () => {
    expect(followOf(ALICE, BOB) == null).toBe(true);
    expect(contract.get_follow(new relationships.get_follow_arguments(null, BOB)).value == null).toBe(true);
    expect(contract.get_follow(new relationships.get_follow_arguments(ALICE, null)).value == null).toBe(true);
    doFollow(ALICE, BOB);
    expect(isFollowing(ALICE, BOB)).toBe(true);
    expect(followOf(BOB, ALICE) == null).toBe(true);
  });

  it("read methods never touch the identity contract", () => {
    // No call results are queued: any cross-contract call would abort the test.
    rel(ALICE, BOB);
    epochOf(ALICE);
    isBlocked(ALICE, BOB);
    followOf(ALICE, BOB);
    contract.get_identity_contract(new relationships.get_identity_contract_arguments());
    expect(MockVM.getCallContractArguments().length).toBe(0);
  });
});
