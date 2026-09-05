// Unit tests for the publications contract (as-pect 8 + Koinos mock VM).
//
// Conventions: as-pect cannot reflect generated protobuf classes, so every
// assertion is on primitives; byte fields are compared with Arrays.equal.
// A revert rolls the mock database back to the last MockVM.commitTransaction(),
// so happy-path calls that later steps depend on are committed explicitly.
//
// Cross-contract calls are stubbed: every System.call consumes one queued
// result (Testing.mockResolveActor / MockVM.setCallContractResults), in call
// order. A first-version reply makes two calls (identity.resolve_actor, then
// relationships.is_blocked); every other write makes exactly one.
//
// Post ids are recomputed here with the same construction the contract uses
// (spec 2.1) over a fixed mock chain id.
import { Arrays, Base58, MockVM, Protobuf, System, Crypto, chain, system_calls } from "@koinos/sdk-as";
import { Publications } from "../Publications";
import { publications } from "../proto/publications";
import { relationships } from "../proto/relationships";
import { identity } from "../proto/identity";
import { Testing } from "../common/testing";
import { Util } from "../common/util";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTRACT_ID = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu");
const IDENTITY_CONTRACT = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK");
const RELATIONSHIPS_CONTRACT = Base58.decode("1M7Hy2AJhQwNoFNfZNgvYS2rGjtCL7nfK8");
const ALICE = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe");
const BOB = Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH");
const CAROL = Base58.decode("161DDwJNQyHqYJbP4C7Y8BTULrkjgC4U6g");
const DEVICE = Base58.decode("1GXe3r3VmkKAEhj6C156jPxQC8p1xbQD2i");

const T0: u64 = Testing.DEFAULT_TIME;
const HOUR: u64 = 3_600_000;

const RESOLVE_ACTOR_ENTRY_POINT: u32 = 0x9f7b95a1;
const IS_BLOCKED_ENTRY_POINT: u32 = 0x10bf8d3f;
const PUBLISH_CAP: u32 = 1;
const REACT_CAP: u32 = 2;
const COMMENT_CAP: u32 = 4;

// Enum values as plain integers (as-pect compares primitives).
const ACTIVE: i32 = 0;
const AUTHOR_HIDDEN: i32 = 1;
const DELETED: i32 = 2;
const UNAVAILABLE: i32 = 3;
const MIGRATED: i32 = 4;
const SUPERSEDED: i32 = 5;

const EVERYONE: i32 = 0;
const FRIENDS: i32 = 1;
const CUSTOM: i32 = 2;

const SUCCEEDED: i32 = 0;
const PARTIAL: i32 = 1;
const FAILED: i32 = 3;

const MAX_ENVELOPE: i32 = 4096;
const MAX_PACKAGES: i32 = 16384;

// Raw multihash-shaped chain id (0x12 0x20 || 32 bytes), as on a real chain.
const CHAIN_ID = Util.concat([pair(0x12, 0x20), filled(32, 0x5a)]);

const ENV_A = filled(64, 0x01);
const ENV_B = filled(64, 0x02);
const ENV_C = filled(64, 0x03);
const ENV_D = filled(64, 0x04);
const IDEM_KEY = filled(16, 0x21);
const IDEM_KEY_2 = filled(16, 0x22);
const AUDIENCE_ID = filled(16, 0xc3);
const MANIFEST = filled(32, 0xd4);

// Read-back buffer large enough for a maximum-size envelope / key package event.
System.setSystemBufferSize(64 * 1024);

let contract!: Publications;

// Arguments under test. Module-level so closures passed to expect().toThrow()
// can reach them (AssemblyScript closures cannot capture locals).
let PUBLISH!: publications.publish_arguments;
let LIFECYCLE!: publications.set_lifecycle_arguments;
let REACT!: publications.react_arguments;
let KEYS!: publications.distribute_keys_arguments;
let CROSS!: publications.record_cross_post_arguments;

// Fixture post ids / versions shared between beforeEach and the tests of a block.
let TARGET: Uint8Array = new Uint8Array(0);
let POST_ID: Uint8Array = new Uint8Array(0);
let VERSION: Uint8Array = new Uint8Array(0);

function filled(n: i32, v: u8): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = v;
  return out;
}

function pair(a: u8, b: u8): Uint8Array {
  const out = new Uint8Array(2);
  out[0] = a;
  out[1] = b;
  return out;
}

/** Raw 32-byte SHA-256 (the mock VM answers with a multihash; strip the prefix). */
function sha256(data: Uint8Array): Uint8Array {
  const digest = System.hash(Crypto.multicodec.sha2_256, data)!;
  if (digest.length == 34) return digest.slice(2);
  return digest;
}

/** Spec 2.1 post id over the mock chain id. */
function postIdFor(author: Uint8Array, sequence: u64, contentHash: Uint8Array): Uint8Array {
  return sha256(
    Util.concat([Util.str("osp/v1/post-id"), CHAIN_ID, Util.u32be(1), author, Util.u64be(sequence), contentHash])
  );
}

// ---------------------------------------------------------------------------
// Mock VM helpers
// ---------------------------------------------------------------------------

function setup(): void {
  Testing.setup(CONTRACT_ID);
  MockVM.setChainId(CHAIN_ID);
  // Testing.setup writes contract id / entry point / arguments after the mock
  // VM's reset commit; commit again so a revert cannot roll that metadata away.
  MockVM.commitTransaction();
  contract = new Publications();
}

function configureIdentity(): void {
  Testing.authorize([CONTRACT_ID]);
  contract.set_identity_contract(new publications.set_identity_contract_arguments(IDENTITY_CONTRACT));
  MockVM.commitTransaction();
}

function configureRelationships(): void {
  Testing.authorize([CONTRACT_ID]);
  contract.set_relationships_contract(new publications.set_relationships_contract_arguments(RELATIONSHIPS_CONTRACT));
  MockVM.commitTransaction();
}

function setupConfigured(): void {
  setup();
  configureIdentity();
  configureRelationships();
}

/** A stubbed identity.resolve_actor answer. */
function resolved(ok: bool, signer: Uint8Array | null, reason: string | null): system_calls.exit_arguments {
  const res = new identity.resolve_actor_result(ok, signer, reason);
  const bytes = Protobuf.encode(res, identity.resolve_actor_result.encode);
  return new system_calls.exit_arguments(0, new chain.result(bytes));
}

/** A stubbed relationships.is_blocked answer. */
function blocked(value: bool): system_calls.exit_arguments {
  const res = new relationships.is_blocked_result(value);
  const bytes = Protobuf.encode(res, relationships.is_blocked_result.encode);
  return new system_calls.exit_arguments(0, new chain.result(bytes));
}

function queue(results: system_calls.exit_arguments[]): void {
  MockVM.setCallContractResults(results);
}

/** Sign as `account` and resolve `calls` identity lookups to that same account (owner path). */
function asOwner(account: Uint8Array, calls: i32 = 1): void {
  Testing.authorize([account]);
  Testing.mockResolveActor(true, account, "", calls);
}

/** Sign as `account`, resolve it, then answer the reply block check with `isBlocked`. */
function asReplier(account: Uint8Array, isBlocked: bool): void {
  Testing.authorize([account]);
  queue([resolved(true, account, null), blocked(isBlocked)]);
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
 * Drop the trace left by fixtures: emitted events (the mock VM returns the
 * whole list through one system-call buffer) and recorded cross-contract
 * calls (they accumulate across commits), so tests assert on the action
 * under test only.
 */
function clearTrace(): void {
  MockVM.clearEvents();
  MockVM.clearCallContractArguments();
}

function callCount(): i32 {
  return MockVM.getCallContractArguments().length;
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

/** Decode the is_blocked arguments of the i-th cross-contract call made so far. */
function blockedCallAt(i: i32): relationships.is_blocked_arguments {
  const calls = MockVM.getCallContractArguments();
  expect(calls.length > i).toBe(true, "cross-contract call index out of range");
  const call = calls[i];
  expect(Arrays.equal(call.contract_id, RELATIONSHIPS_CONTRACT)).toBe(true, "call targets relationships contract");
  expect(call.entry_point).toBe(IS_BLOCKED_ENTRY_POINT, "call entry point");
  return Protobuf.decode<relationships.is_blocked_arguments>(call.args, relationships.is_blocked_arguments.decode);
}

function publishedData(ev: system_calls.event_arguments): publications.published_event {
  expect(ev.name).toBe("osp.publications.published");
  return Protobuf.decode<publications.published_event>(ev.data, publications.published_event.decode);
}

// ---------------------------------------------------------------------------
// Argument builders and call wrappers
// ---------------------------------------------------------------------------

/** First-version publish arguments with a correct post id for (author, sequence, envelope). */
function firstPost(
  author: Uint8Array,
  sequence: u64,
  envelope: Uint8Array,
  audience: i32 = EVERYONE,
  replyTo: Uint8Array | null = null,
  idempotencyKey: Uint8Array | null = null
): publications.publish_arguments {
  const contentHash = sha256(envelope);
  const postId = postIdFor(author, sequence, contentHash);
  return new publications.publish_arguments(
    author,
    postId,
    null,
    sequence,
    <publications.audience_kind>audience,
    null,
    0,
    envelope,
    contentHash,
    [],
    replyTo,
    idempotencyKey,
    null
  );
}

/** Edit arguments: a new version of `postId` replacing `previousVersion`. */
function edit(
  author: Uint8Array,
  postId: Uint8Array,
  previousVersion: Uint8Array,
  envelope: Uint8Array,
  audience: i32 = EVERYONE
): publications.publish_arguments {
  return new publications.publish_arguments(
    author,
    postId,
    previousVersion,
    0,
    <publications.audience_kind>audience,
    null,
    0,
    envelope,
    sha256(envelope),
    [],
    null,
    null,
    null
  );
}

function lifecycle(
  author: Uint8Array,
  postId: Uint8Array,
  version: Uint8Array | null,
  state: i32,
  reason: string | null = null,
  replacementId: Uint8Array | null = null
): publications.set_lifecycle_arguments {
  return new publications.set_lifecycle_arguments(
    author,
    postId,
    version,
    <publications.lifecycle_state>state,
    reason,
    replacementId,
    null
  );
}

function react(actor: Uint8Array, postId: Uint8Array, reaction: u32 = 1, remove: bool = false): publications.react_arguments {
  return new publications.react_arguments(actor, postId, reaction, remove, null);
}

function keys(author: Uint8Array, packages: Uint8Array, audienceId: Uint8Array | null = null, epoch: u32 = 0): publications.distribute_keys_arguments {
  return new publications.distribute_keys_arguments(author, audienceId, epoch, packages, null);
}

function crossPost(
  author: Uint8Array,
  idempotencyKey: Uint8Array | null,
  adapter: string | null,
  state: i32,
  externalRef: string | null = null,
  postId: Uint8Array | null = null,
  manifestHash: Uint8Array | null = null
): publications.record_cross_post_arguments {
  return new publications.record_cross_post_arguments(
    author,
    idempotencyKey,
    adapter,
    <publications.outcome_state>state,
    externalRef,
    postId,
    manifestHash,
    null
  );
}

function callPublish(): void {
  contract.publish(PUBLISH);
}

function callLifecycle(): void {
  contract.set_lifecycle(LIFECYCLE);
}

function callReact(): void {
  contract.react(REACT);
}

function callKeys(): void {
  contract.distribute_keys(KEYS);
}

function callCrossPost(): void {
  contract.record_cross_post(CROSS);
}

// Committed happy-path steps used as fixtures by later assertions.

/** Publish `args` as its author (owner path) and commit; returns the post id. */
function doPublish(args: publications.publish_arguments, calls: i32 = 1): Uint8Array {
  asOwner(args.author!, calls);
  contract.publish(args);
  MockVM.commitTransaction();
  return args.post_id!;
}

function doLifecycle(args: publications.set_lifecycle_arguments): void {
  asOwner(args.author!, 1);
  contract.set_lifecycle(args);
  MockVM.commitTransaction();
}

// Reads.

function post(postId: Uint8Array): publications.post_record | null {
  return contract.get_post(new publications.get_post_arguments(postId)).value;
}

function postOrFail(postId: Uint8Array): publications.post_record {
  const rec = post(postId);
  expect(rec == null).toBe(false, "post record missing");
  return rec!;
}

function authorState(author: Uint8Array): publications.author_state {
  const state = contract.get_author_state(new publications.get_author_state_arguments(author)).value;
  expect(state == null).toBe(false, "author state must never be null");
  return state!;
}

function idemLookup(author: Uint8Array, key: Uint8Array | null): publications.post_ref | null {
  return contract.get_post_by_idempotency_key(new publications.get_post_by_idempotency_key_arguments(author, key)).value;
}

function dependencies(): publications.get_dependencies_result {
  return contract.get_dependencies(new publications.get_dependencies_arguments());
}

// ---------------------------------------------------------------------------
// Admin: set_identity_contract / set_relationships_contract / get_dependencies
// ---------------------------------------------------------------------------

describe("publications: dependencies", () => {
  beforeEach(() => {
    setup();
  });

  it("are unset by default", () => {
    const deps = dependencies();
    expect(deps.identity == null || deps.identity!.length == 0).toBe(true);
    expect(deps.relationships == null || deps.relationships!.length == 0).toBe(true);
  });

  it("set_identity_contract stores the address when signed by the contract account", () => {
    configureIdentity();
    const deps = dependencies();
    expect(Arrays.equal(deps.identity!, IDENTITY_CONTRACT)).toBe(true);
    expect(deps.relationships == null || deps.relationships!.length == 0).toBe(true);
  });

  it("set_relationships_contract stores the address and keeps the identity address", () => {
    configureIdentity();
    configureRelationships();
    const deps = dependencies();
    expect(Arrays.equal(deps.identity!, IDENTITY_CONTRACT)).toBe(true);
    expect(Arrays.equal(deps.relationships!, RELATIONSHIPS_CONTRACT)).toBe(true);
  });

  it("rejects a signer other than the contract account", () => {
    Testing.authorize([ALICE]);
    expect(() => {
      contract.set_identity_contract(new publications.set_identity_contract_arguments(IDENTITY_CONTRACT));
    }).toThrow();
    expectRevert("authorization failed");
    expect(() => {
      contract.set_relationships_contract(new publications.set_relationships_contract_arguments(RELATIONSHIPS_CONTRACT));
    }).toThrow();
    expectRevert("authorization failed");
    const deps = dependencies();
    expect(deps.identity == null || deps.identity!.length == 0).toBe(true);
    expect(deps.relationships == null || deps.relationships!.length == 0).toBe(true);
  });

  it("rejects malformed addresses", () => {
    Testing.authorize([CONTRACT_ID]);
    expect(() => {
      contract.set_identity_contract(new publications.set_identity_contract_arguments(filled(10, 1)));
    }).toThrow();
    expectRevert("address must be a 25-byte address");
    expect(() => {
      contract.set_relationships_contract(new publications.set_relationships_contract_arguments(null));
    }).toThrow();
    expectRevert("address is required");
  });

  it("can be replaced by the contract account", () => {
    configureIdentity();
    configureRelationships();
    Testing.authorize([CONTRACT_ID]);
    contract.set_identity_contract(new publications.set_identity_contract_arguments(CAROL));
    contract.set_relationships_contract(new publications.set_relationships_contract_arguments(BOB));
    const deps = dependencies();
    expect(Arrays.equal(deps.identity!, CAROL)).toBe(true);
    expect(Arrays.equal(deps.relationships!, BOB)).toBe(true);
  });

  it("write methods revert while the identity contract is not configured", () => {
    Testing.authorize([ALICE]);
    PUBLISH = firstPost(ALICE, 1, ENV_A);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("identity contract not configured");
    REACT = react(ALICE, PUBLISH.post_id!);
    expect(() => {
      callReact();
    }).toThrow();
    expectRevert("identity contract not configured");
    KEYS = keys(ALICE, filled(8, 1));
    expect(() => {
      callKeys();
    }).toThrow();
    expectRevert("identity contract not configured");
    expect(callCount()).toBe(0);
  });

  it("a reply reverts while the relationships contract is not configured", () => {
    configureIdentity();
    const target = doPublish(firstPost(BOB, 1, ENV_A));
    Testing.authorize([ALICE]);
    Testing.mockResolveActor(true, ALICE, "", 1);
    PUBLISH = firstPost(ALICE, 1, ENV_B, EVERYONE, target);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("relationships contract not configured");
    expect(post(PUBLISH.post_id!) == null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// get_limits
// ---------------------------------------------------------------------------

describe("publications: get_limits", () => {
  beforeEach(() => {
    setup();
  });

  it("returns the pilot limits and protocol version", () => {
    const limits = contract.get_limits(new publications.get_limits_arguments()).value;
    expect(limits == null).toBe(false);
    expect(limits!.max_envelope_bytes).toBe(4096);
    expect(limits!.max_media_refs).toBe(8);
    expect(limits!.max_key_package_bytes).toBe(16384);
    expect(limits!.max_idempotency_key_bytes).toBe(32);
    expect(limits!.max_location_chars).toBe(256);
    expect(limits!.protocol_version).toBe(1);
    expect(callCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// publish: first version
// ---------------------------------------------------------------------------

describe("publications: publish (first version)", () => {
  beforeEach(() => {
    setupConfigured();
  });

  it("creates the post record, advances the author state and emits osp.publications.published", () => {
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 1, ENV_A);
    callPublish();

    const postId = PUBLISH.post_id!;
    const contentHash = sha256(ENV_A);
    const rec = postOrFail(postId);
    expect(Arrays.equal(rec.author!, ALICE)).toBe(true);
    expect(rec.sequence).toBe(1);
    expect(rec.version_count).toBe(1);
    expect(Arrays.equal(rec.latest_version!, contentHash)).toBe(true);
    expect(<i32>rec.state).toBe(ACTIVE);
    expect(rec.reply_to == null || rec.reply_to!.length == 0).toBe(true);
    expect(<i32>rec.audience).toBe(EVERYONE);
    expect(rec.created_at).toBe(T0);
    expect(rec.updated_at).toBe(T0);

    const state = authorState(ALICE);
    expect(state.next_sequence).toBe(2);
    expect(state.post_count).toBe(1);
    expect(state.last_publish_at).toBe(T0);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expectImpacted(ev, [ALICE]);
    const data = publishedData(ev);
    expect(Arrays.equal(data.author!, ALICE)).toBe(true);
    expect(Arrays.equal(data.post_id!, postId)).toBe(true);
    expect(Arrays.equal(data.content_hash!, contentHash)).toBe(true);
    expect(data.previous_version == null || data.previous_version!.length == 0).toBe(true);
    expect(data.version_number).toBe(1);
    expect(data.sequence).toBe(1);
    expect(<i32>data.audience).toBe(EVERYONE);
    expect(data.epoch).toBe(0);
    expect(Arrays.equal(data.envelope!, ENV_A)).toBe(true);
    expect(data.media.length).toBe(0);
    expect(data.reply_to == null || data.reply_to!.length == 0).toBe(true);
    expect(data.idempotency_key == null || data.idempotency_key!.length == 0).toBe(true);
    expect(data.protocol_version).toBe(1);
    expect(data.timestamp).toBe(T0);

    // Exactly one cross-contract call: the author with the PUBLISH capability.
    expect(callCount()).toBe(1);
    const call = resolveCallAt(0);
    expect(Arrays.equal(call.account!, ALICE)).toBe(true);
    expect(call.device == null || call.device!.length == 0).toBe(true);
    expect(call.capability).toBe(PUBLISH_CAP);
  });

  it("uses the head block time for created_at and last_publish_at", () => {
    Testing.setTime(T0 + HOUR);
    const postId = doPublish(firstPost(ALICE, 1, ENV_A));
    expect(postOrFail(postId).created_at).toBe(T0 + HOUR);
    expect(authorState(ALICE).last_publish_at).toBe(T0 + HOUR);
  });

  it("consumes sequences strictly in order and produces distinct post ids", () => {
    const first = doPublish(firstPost(ALICE, 1, ENV_A));
    const second = doPublish(firstPost(ALICE, 2, ENV_B));
    expect(Arrays.equal(first, second)).toBe(false);
    expect(postOrFail(second).sequence).toBe(2);
    const state = authorState(ALICE);
    expect(state.next_sequence).toBe(3);
    expect(state.post_count).toBe(2);
    // Sequences are per author.
    const bobs = doPublish(firstPost(BOB, 1, ENV_A));
    expect(postOrFail(bobs).sequence).toBe(1);
    expect(authorState(BOB).next_sequence).toBe(2);
    expect(authorState(ALICE).next_sequence).toBe(3);
  });

  it("accepts a device signer holding the publish capability", () => {
    Testing.authorize([DEVICE]);
    Testing.mockResolveActor(true, DEVICE, "", 1);
    PUBLISH = firstPost(ALICE, 1, ENV_A);
    PUBLISH.device = DEVICE;
    callPublish();
    expect(post(PUBLISH.post_id!) == null).toBe(false);
    const call = resolveCallAt(0);
    expect(Arrays.equal(call.account!, ALICE)).toBe(true);
    expect(Arrays.equal(call.device!, DEVICE)).toBe(true);
    expect(call.capability).toBe(PUBLISH_CAP);
  });

  it("rejects a transaction not signed by the resolved signer", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "", 1);
    PUBLISH = firstPost(ALICE, 1, ENV_A);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("authorization failed");
    expect(post(PUBLISH.post_id!) == null).toBe(true);
    expect(authorState(ALICE).next_sequence).toBe(1);
  });

  it("rejects an unregistered author and propagates device rejections", () => {
    Testing.authorize([ALICE]);
    Testing.mockResolveActor(false, null, "unregistered", 1);
    PUBLISH = firstPost(ALICE, 1, ENV_A);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("unregistered");
    Testing.authorize([DEVICE]);
    Testing.mockResolveActor(false, null, "capability not granted", 1);
    PUBLISH.device = DEVICE;
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("capability not granted");
  });

  it("rejects malformed author, post_id and content_hash before any cross-contract call", () => {
    Testing.authorize([ALICE]);
    PUBLISH = firstPost(ALICE, 1, ENV_A);
    PUBLISH.author = filled(3, 1);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("author must be a 25-byte address");

    PUBLISH = firstPost(ALICE, 1, ENV_A);
    PUBLISH.post_id = filled(31, 1);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("post_id must be 32 bytes");

    PUBLISH = firstPost(ALICE, 1, ENV_A);
    PUBLISH.post_id = null;
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("post_id is required");

    PUBLISH = firstPost(ALICE, 1, ENV_A);
    PUBLISH.content_hash = filled(33, 1);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("content_hash must be 32 bytes");

    PUBLISH = firstPost(ALICE, 1, ENV_A);
    PUBLISH.content_hash = null;
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("content_hash is required");
    expect(callCount()).toBe(0);
  });

  it("rejects a wrong sequence", () => {
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 2, ENV_A);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("sequence mismatch");

    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 0, ENV_A);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("sequence mismatch");

    // After the first post only sequence 2 is accepted.
    doPublish(firstPost(ALICE, 1, ENV_A));
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 1, ENV_B);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("sequence mismatch");
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 3, ENV_B);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("sequence mismatch");
    expect(authorState(ALICE).next_sequence).toBe(2);
  });

  it("rejects a post id that does not match the recomputed id", () => {
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 1, ENV_A);
    PUBLISH.post_id = filled(32, 0x09);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("post id mismatch");

    // An id computed for another author is also rejected.
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 1, ENV_A);
    PUBLISH.post_id = postIdFor(BOB, 1, sha256(ENV_A));
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("post id mismatch");

    // ... and one computed for another sequence.
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 1, ENV_A);
    PUBLISH.post_id = postIdFor(ALICE, 2, sha256(ENV_A));
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("post id mismatch");
    expect(authorState(ALICE).next_sequence).toBe(1);
  });

  it("rejects a content hash that does not match the envelope", () => {
    Testing.authorize([ALICE]);
    PUBLISH = firstPost(ALICE, 1, ENV_A);
    PUBLISH.content_hash = sha256(ENV_B);
    PUBLISH.post_id = postIdFor(ALICE, 1, sha256(ENV_B));
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("content hash mismatch");
    expect(callCount()).toBe(0);
  });

  it("accepts an empty envelope with the content hash as given", () => {
    asOwner(ALICE);
    const contentHash = filled(32, 0x77);
    PUBLISH = new publications.publish_arguments(
      ALICE,
      postIdFor(ALICE, 1, contentHash),
      null,
      1,
      publications.audience_kind.everyone,
      null,
      0,
      null,
      contentHash,
      [],
      null,
      null,
      null
    );
    callPublish();
    const rec = postOrFail(PUBLISH.post_id!);
    expect(Arrays.equal(rec.latest_version!, contentHash)).toBe(true);
    const data = publishedData(lastEvent());
    expect(data.envelope == null || data.envelope!.length == 0).toBe(true);
  });

  it("rejects an oversize envelope and accepts a maximum-size one", () => {
    Testing.authorize([ALICE]);
    PUBLISH = firstPost(ALICE, 1, filled(MAX_ENVELOPE + 1, 0x11));
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("envelope too large");
    expect(callCount()).toBe(0);

    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 1, filled(MAX_ENVELOPE, 0x12));
    callPublish();
    expect(post(PUBLISH.post_id!) == null).toBe(false);
    const data = publishedData(lastEvent());
    expect(data.envelope!.length).toBe(MAX_ENVELOPE);
  });

  it("rejects an existing post id", () => {
    const postId = doPublish(firstPost(ALICE, 1, ENV_A));
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 2, ENV_B);
    PUBLISH.post_id = postId;
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("post already exists");
    expect(postOrFail(postId).version_count).toBe(1);
    expect(authorState(ALICE).next_sequence).toBe(2);
  });

  it("carries media references into the event and validates them", () => {
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 1, ENV_A);
    PUBLISH.media = [
      new publications.media_ref(filled(32, 0x21), "image/png", 1234, ["ipfs://one", "https://two"], filled(8, 0x22)),
      new publications.media_ref(null, "video/mp4", 99, [], null),
    ];
    callPublish();
    const data = publishedData(lastEvent());
    expect(data.media.length).toBe(2);
    expect(Arrays.equal(data.media[0].content_hash!, filled(32, 0x21))).toBe(true);
    expect(data.media[0].mime!).toBe("image/png");
    expect(data.media[0].size).toBe(1234);
    expect(data.media[0].locations.length).toBe(2);
    expect(data.media[0].locations[1]).toBe("https://two");
    expect(Arrays.equal(data.media[0].key_ref!, filled(8, 0x22))).toBe(true);
    expect(data.media[1].mime!).toBe("video/mp4");
    MockVM.commitTransaction();

    // Limits: count, mime, content hash, locations.
    Testing.authorize([ALICE]);
    const many: publications.media_ref[] = [];
    for (let i = 0; i < 9; i++) many.push(new publications.media_ref(null, "x", 0, [], null));
    PUBLISH = firstPost(ALICE, 2, ENV_B);
    PUBLISH.media = many;
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("too many media refs");

    PUBLISH = firstPost(ALICE, 2, ENV_B);
    PUBLISH.media = [new publications.media_ref(null, "m".repeat(129), 0, [], null)];
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("media mime too long");

    PUBLISH = firstPost(ALICE, 2, ENV_B);
    PUBLISH.media = [new publications.media_ref(filled(31, 1), "x", 0, [], null)];
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("media content_hash must be empty or 32 bytes");

    PUBLISH = firstPost(ALICE, 2, ENV_B);
    PUBLISH.media = [new publications.media_ref(null, "x", 0, ["a", "b", "c", "d", "e"], null)];
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("too many media locations");

    PUBLISH = firstPost(ALICE, 2, ENV_B);
    PUBLISH.media = [new publications.media_ref(null, "x", 0, ["l".repeat(257)], null)];
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("media location too long");

    // Boundary values are accepted: 8 refs, 4 locations of 256 chars, 128-char mime.
    asOwner(ALICE);
    const eight: publications.media_ref[] = [];
    for (let i = 0; i < 8; i++) {
      eight.push(
        new publications.media_ref(null, "m".repeat(128), 0, ["l".repeat(256), "b", "c", "d"], null)
      );
    }
    PUBLISH = firstPost(ALICE, 2, ENV_B);
    PUBLISH.media = eight;
    callPublish();
    expect(postOrFail(PUBLISH.post_id!).sequence).toBe(2);
  });

  it("stores audience kind and echoes audience id and epoch", () => {
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 1, ENV_A, FRIENDS);
    PUBLISH.epoch = 7;
    callPublish();
    expect(<i32>postOrFail(PUBLISH.post_id!).audience).toBe(FRIENDS);
    let data = publishedData(lastEvent());
    expect(<i32>data.audience).toBe(FRIENDS);
    expect(data.epoch).toBe(7);
    MockVM.commitTransaction();

    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 2, ENV_B, CUSTOM);
    PUBLISH.audience_id = AUDIENCE_ID;
    PUBLISH.epoch = 3;
    callPublish();
    expect(<i32>postOrFail(PUBLISH.post_id!).audience).toBe(CUSTOM);
    data = publishedData(lastEvent());
    expect(<i32>data.audience).toBe(CUSTOM);
    expect(Arrays.equal(data.audience_id!, AUDIENCE_ID)).toBe(true);
    expect(data.epoch).toBe(3);
  });

  it("rejects an unknown audience kind, a custom audience without id and an oversize audience id", () => {
    Testing.authorize([ALICE]);
    PUBLISH = firstPost(ALICE, 1, ENV_A, 7);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("unknown audience");

    PUBLISH = firstPost(ALICE, 1, ENV_A, CUSTOM);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("custom audience requires audience_id");

    PUBLISH = firstPost(ALICE, 1, ENV_A, CUSTOM);
    PUBLISH.audience_id = filled(33, 1);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("audience_id too large");
    expect(callCount()).toBe(0);
  });

  it("stores the idempotency key and resolves it to the post", () => {
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 1, ENV_A, EVERYONE, null, IDEM_KEY);
    callPublish();
    const ref = idemLookup(ALICE, IDEM_KEY);
    expect(ref == null).toBe(false);
    expect(Arrays.equal(ref!.post_id!, PUBLISH.post_id!)).toBe(true);
    const data = publishedData(lastEvent());
    expect(Arrays.equal(data.idempotency_key!, IDEM_KEY)).toBe(true);
    // Other keys and other authors are unaffected.
    expect(idemLookup(ALICE, IDEM_KEY_2) == null).toBe(true);
    expect(idemLookup(BOB, IDEM_KEY) == null).toBe(true);
  });

  it("rejects a duplicate idempotency key for the same author", () => {
    doPublish(firstPost(ALICE, 1, ENV_A, EVERYONE, null, IDEM_KEY));
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 2, ENV_B, EVERYONE, null, IDEM_KEY);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("duplicate idempotency key");
    expect(post(PUBLISH.post_id!) == null).toBe(true);
    expect(authorState(ALICE).next_sequence).toBe(2);
    // The key still resolves to the first post.
    expect(Arrays.equal(idemLookup(ALICE, IDEM_KEY)!.post_id!, postIdFor(ALICE, 1, sha256(ENV_A)))).toBe(true);
    // Another author may use the same key.
    const bobs = doPublish(firstPost(BOB, 1, ENV_A, EVERYONE, null, IDEM_KEY));
    expect(Arrays.equal(idemLookup(BOB, IDEM_KEY)!.post_id!, bobs)).toBe(true);
  });

  it("rejects an oversize idempotency key and accepts a 32-byte one", () => {
    Testing.authorize([ALICE]);
    PUBLISH = firstPost(ALICE, 1, ENV_A, EVERYONE, null, filled(33, 1));
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("idempotency key too large");
    expect(callCount()).toBe(0);

    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 1, ENV_A, EVERYONE, null, filled(32, 1));
    callPublish();
    expect(idemLookup(ALICE, filled(32, 1)) == null).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// publish: replies
// ---------------------------------------------------------------------------

describe("publications: publish (reply)", () => {

  beforeEach(() => {
    setupConfigured();
    TARGET = doPublish(firstPost(BOB, 1, ENV_A));
    clearTrace();
  });

  it("links the reply, checks the block list and impacts both authors", () => {
    asReplier(ALICE, false);
    PUBLISH = firstPost(ALICE, 1, ENV_B, EVERYONE, TARGET);
    callPublish();

    const rec = postOrFail(PUBLISH.post_id!);
    expect(Arrays.equal(rec.reply_to!, TARGET)).toBe(true);
    expect(authorState(ALICE).next_sequence).toBe(2);
    // The target is untouched.
    expect(postOrFail(TARGET).version_count).toBe(1);

    const ev = lastEvent();
    expectImpacted(ev, [ALICE, BOB]);
    const data = publishedData(ev);
    expect(Arrays.equal(data.reply_to!, TARGET)).toBe(true);

    // resolve_actor with the COMMENT capability, then is_blocked(target author, replier).
    expect(callCount()).toBe(2);
    const resolve = resolveCallAt(0);
    expect(Arrays.equal(resolve.account!, ALICE)).toBe(true);
    expect(resolve.capability).toBe(COMMENT_CAP);
    const check = blockedCallAt(1);
    expect(Arrays.equal(check.actor!, BOB)).toBe(true);
    expect(Arrays.equal(check.target!, ALICE)).toBe(true);
  });

  it("rejects a reply when the target author blocked the replier", () => {
    asReplier(ALICE, true);
    PUBLISH = firstPost(ALICE, 1, ENV_B, EVERYONE, TARGET);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("blocked by author");
    expect(post(PUBLISH.post_id!) == null).toBe(true);
    expect(authorState(ALICE).next_sequence).toBe(1);
    expect(eventCount()).toBe(0);
  });

  it("rejects a malformed reply_to", () => {
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 1, ENV_B, EVERYONE, filled(16, 1));
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("reply_to must be 32 bytes");
  });

  it("rejects a reply to a missing post", () => {
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 1, ENV_B, EVERYONE, filled(32, 0x33));
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("reply target not found");
    // No block check is made for a missing target.
    expect(callCount()).toBe(1);
  });

  it("rejects a reply to a deleted post but allows a hidden one", () => {
    doLifecycle(lifecycle(BOB, TARGET, sha256(ENV_A), DELETED));
    asOwner(ALICE);
    PUBLISH = firstPost(ALICE, 1, ENV_B, EVERYONE, TARGET);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("reply target deleted");

    const hidden = doPublish(firstPost(BOB, 2, ENV_C));
    doLifecycle(lifecycle(BOB, hidden, sha256(ENV_C), AUTHOR_HIDDEN));
    asReplier(ALICE, false);
    PUBLISH = firstPost(ALICE, 1, ENV_B, EVERYONE, hidden);
    callPublish();
    expect(Arrays.equal(postOrFail(PUBLISH.post_id!).reply_to!, hidden)).toBe(true);
  });

  it("skips the block check for a reply to your own post", () => {
    asOwner(BOB);
    PUBLISH = firstPost(BOB, 2, ENV_B, EVERYONE, TARGET);
    callPublish();
    expect(callCount()).toBe(1);
    expectImpacted(lastEvent(), [BOB]);
    expect(Arrays.equal(postOrFail(PUBLISH.post_id!).reply_to!, TARGET)).toBe(true);
  });

  it("requires the resolved signer to have signed", () => {
    Testing.authorize([CAROL]);
    queue([resolved(true, ALICE, null), blocked(false)]);
    PUBLISH = firstPost(ALICE, 1, ENV_B, EVERYONE, TARGET);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("authorization failed");
    expect(callCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// publish: edits
// ---------------------------------------------------------------------------

describe("publications: publish (edit)", () => {

  beforeEach(() => {
    setupConfigured();
    POST_ID = doPublish(firstPost(ALICE, 1, ENV_A));
    clearTrace();
  });

  it("publishes a new version under the same post id", () => {
    Testing.setTime(T0 + HOUR);
    asOwner(ALICE);
    PUBLISH = edit(ALICE, POST_ID, sha256(ENV_A), ENV_B);
    PUBLISH.sequence = 99; // ignored for edits
    callPublish();

    const rec = postOrFail(POST_ID);
    expect(rec.version_count).toBe(2);
    expect(Arrays.equal(rec.latest_version!, sha256(ENV_B))).toBe(true);
    expect(rec.sequence).toBe(1);
    expect(rec.created_at).toBe(T0);
    expect(rec.updated_at).toBe(T0 + HOUR);
    expect(<i32>rec.state).toBe(ACTIVE);

    // Author sequence state is untouched by edits.
    const state = authorState(ALICE);
    expect(state.next_sequence).toBe(2);
    expect(state.post_count).toBe(1);
    expect(state.last_publish_at).toBe(T0);

    const ev = lastEvent();
    expectImpacted(ev, [ALICE]);
    const data = publishedData(ev);
    expect(Arrays.equal(data.post_id!, POST_ID)).toBe(true);
    expect(Arrays.equal(data.content_hash!, sha256(ENV_B))).toBe(true);
    expect(Arrays.equal(data.previous_version!, sha256(ENV_A))).toBe(true);
    expect(data.version_number).toBe(2);
    expect(data.sequence).toBe(1);
    expect(Arrays.equal(data.envelope!, ENV_B)).toBe(true);
    expect(data.timestamp).toBe(T0 + HOUR);

    expect(callCount()).toBe(1);
    expect(resolveCallAt(0).capability).toBe(PUBLISH_CAP);
  });

  it("chains versions: the third version must reference the second", () => {
    doPublish(edit(ALICE, POST_ID, sha256(ENV_A), ENV_B));
    asOwner(ALICE);
    PUBLISH = edit(ALICE, POST_ID, sha256(ENV_A), ENV_C);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("stale version");

    doPublish(edit(ALICE, POST_ID, sha256(ENV_B), ENV_C));
    const rec = postOrFail(POST_ID);
    expect(rec.version_count).toBe(3);
    expect(Arrays.equal(rec.latest_version!, sha256(ENV_C))).toBe(true);
  });

  it("rejects a stale or malformed previous version", () => {
    asOwner(ALICE);
    PUBLISH = edit(ALICE, POST_ID, sha256(ENV_C), ENV_B);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("stale version");

    asOwner(ALICE);
    PUBLISH = edit(ALICE, POST_ID, filled(8, 1), ENV_B);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("stale version");
    expect(postOrFail(POST_ID).version_count).toBe(1);
  });

  it("rejects an edit by another author", () => {
    asOwner(BOB);
    PUBLISH = edit(BOB, POST_ID, sha256(ENV_A), ENV_B);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("author mismatch");
    expect(postOrFail(POST_ID).version_count).toBe(1);
  });

  it("rejects an audience change", () => {
    asOwner(ALICE);
    PUBLISH = edit(ALICE, POST_ID, sha256(ENV_A), ENV_B, FRIENDS);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("audience change not allowed");
    expect(<i32>postOrFail(POST_ID).audience).toBe(EVERYONE);
  });

  it("rejects an edit of a deleted post", () => {
    doLifecycle(lifecycle(ALICE, POST_ID, sha256(ENV_A), DELETED));
    asOwner(ALICE);
    PUBLISH = edit(ALICE, POST_ID, sha256(ENV_A), ENV_B);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("post deleted");
    expect(postOrFail(POST_ID).version_count).toBe(1);
  });

  it("rejects an edit of an unknown post", () => {
    asOwner(ALICE);
    PUBLISH = edit(ALICE, filled(32, 0x44), sha256(ENV_A), ENV_B);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("post not found");
  });

  it("validates the envelope of an edit", () => {
    Testing.authorize([ALICE]);
    PUBLISH = edit(ALICE, POST_ID, sha256(ENV_A), ENV_B);
    PUBLISH.content_hash = sha256(ENV_C);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("content hash mismatch");
    PUBLISH = edit(ALICE, POST_ID, sha256(ENV_A), filled(MAX_ENVELOPE + 1, 1));
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("envelope too large");
    expect(callCount()).toBe(0);
  });

  it("reserves an idempotency key supplied with an edit", () => {
    asOwner(ALICE);
    PUBLISH = edit(ALICE, POST_ID, sha256(ENV_A), ENV_B);
    PUBLISH.idempotency_key = IDEM_KEY;
    callPublish();
    MockVM.commitTransaction();
    expect(Arrays.equal(idemLookup(ALICE, IDEM_KEY)!.post_id!, POST_ID)).toBe(true);

    asOwner(ALICE);
    PUBLISH = edit(ALICE, POST_ID, sha256(ENV_B), ENV_C);
    PUBLISH.idempotency_key = IDEM_KEY;
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("duplicate idempotency key");
    expect(postOrFail(POST_ID).version_count).toBe(2);
  });

  it("keeps the thread position of a reply across edits", () => {
    const target = doPublish(firstPost(BOB, 1, ENV_C));
    const reply = doPublish(firstPost(ALICE, 2, ENV_D, EVERYONE, target), 2);
    clearTrace();

    // reply_to omitted: the stored link is emitted and the target author impacted.
    asOwner(ALICE);
    PUBLISH = edit(ALICE, reply, sha256(ENV_D), ENV_B);
    callPublish();
    MockVM.commitTransaction();
    let ev = lastEvent();
    expectImpacted(ev, [ALICE, BOB]);
    expect(Arrays.equal(publishedData(ev).reply_to!, target)).toBe(true);
    expect(Arrays.equal(postOrFail(reply).reply_to!, target)).toBe(true);
    expect(callCount()).toBe(1);

    // reply_to equal to the stored link: accepted, COMMENT capability, no block check.
    asOwner(ALICE);
    PUBLISH = edit(ALICE, reply, sha256(ENV_B), ENV_C);
    PUBLISH.reply_to = target;
    callPublish();
    MockVM.commitTransaction();
    expect(callCount()).toBe(2);
    expect(resolveCallAt(1).capability).toBe(COMMENT_CAP);
    expect(postOrFail(reply).version_count).toBe(3);

    // A different reply_to is rejected.
    asOwner(ALICE);
    PUBLISH = edit(ALICE, reply, sha256(ENV_C), ENV_D);
    PUBLISH.reply_to = POST_ID;
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("reply_to change not allowed");

    // A top-level post cannot become a reply.
    asOwner(ALICE);
    PUBLISH = edit(ALICE, POST_ID, sha256(ENV_A), ENV_B);
    PUBLISH.reply_to = target;
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("reply_to change not allowed");
    expect(postOrFail(POST_ID).version_count).toBe(1);
  });

  it("rejects a transaction not signed by the resolved signer", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "", 1);
    PUBLISH = edit(ALICE, POST_ID, sha256(ENV_A), ENV_B);
    expect(() => {
      callPublish();
    }).toThrow();
    expectRevert("authorization failed");
    expect(postOrFail(POST_ID).version_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// set_lifecycle
// ---------------------------------------------------------------------------

describe("publications: set_lifecycle", () => {

  beforeEach(() => {
    setupConfigured();
    POST_ID = doPublish(firstPost(ALICE, 1, ENV_A));
    VERSION = sha256(ENV_A);
    clearTrace();
  });

  it("updates the state and emits osp.publications.lifecycle", () => {
    Testing.setTime(T0 + HOUR);
    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, AUTHOR_HIDDEN, "not now");
    callLifecycle();

    const rec = postOrFail(POST_ID);
    expect(<i32>rec.state).toBe(AUTHOR_HIDDEN);
    expect(rec.updated_at).toBe(T0 + HOUR);
    expect(rec.created_at).toBe(T0);
    expect(rec.version_count).toBe(1);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.publications.lifecycle");
    expectImpacted(ev, [ALICE]);
    const data = Protobuf.decode<publications.lifecycle_event>(ev.data, publications.lifecycle_event.decode);
    expect(Arrays.equal(data.author!, ALICE)).toBe(true);
    expect(Arrays.equal(data.post_id!, POST_ID)).toBe(true);
    expect(Arrays.equal(data.version!, VERSION)).toBe(true);
    expect(<i32>data.state).toBe(AUTHOR_HIDDEN);
    expect(data.reason!).toBe("not now");
    expect(data.replacement_id == null || data.replacement_id!.length == 0).toBe(true);
    expect(data.timestamp).toBe(T0 + HOUR);

    expect(callCount()).toBe(1);
    const call = resolveCallAt(0);
    expect(Arrays.equal(call.account!, ALICE)).toBe(true);
    expect(call.capability).toBe(PUBLISH_CAP);
  });

  it("moves between non-terminal states freely", () => {
    doLifecycle(lifecycle(ALICE, POST_ID, VERSION, AUTHOR_HIDDEN));
    doLifecycle(lifecycle(ALICE, POST_ID, VERSION, UNAVAILABLE));
    doLifecycle(lifecycle(ALICE, POST_ID, VERSION, ACTIVE));
    expect(<i32>postOrFail(POST_ID).state).toBe(ACTIVE);
    doLifecycle(lifecycle(ALICE, POST_ID, VERSION, SUPERSEDED, null, filled(32, 0x55)));
    doLifecycle(lifecycle(ALICE, POST_ID, VERSION, ACTIVE));
    expect(<i32>postOrFail(POST_ID).state).toBe(ACTIVE);
  });

  it("accepts a device signer with the publish capability", () => {
    Testing.authorize([DEVICE]);
    Testing.mockResolveActor(true, DEVICE, "", 1);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, AUTHOR_HIDDEN);
    LIFECYCLE.device = DEVICE;
    callLifecycle();
    expect(<i32>postOrFail(POST_ID).state).toBe(AUTHOR_HIDDEN);
    expect(Arrays.equal(resolveCallAt(0).device!, DEVICE)).toBe(true);
  });

  it("rejects a transaction not signed by the resolved signer", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "", 1);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, DELETED);
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("authorization failed");
    expect(<i32>postOrFail(POST_ID).state).toBe(ACTIVE);
  });

  it("rejects unknown posts, other authors and VERSION mismatches", () => {
    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, filled(32, 0x66), VERSION, DELETED);
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("post not found");

    asOwner(BOB);
    LIFECYCLE = lifecycle(BOB, POST_ID, VERSION, DELETED);
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("author mismatch");

    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, POST_ID, sha256(ENV_B), DELETED);
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("version mismatch");

    // After an edit, only the latest version can be addressed.
    doPublish(edit(ALICE, POST_ID, VERSION, ENV_B));
    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, DELETED);
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("version mismatch");
    doLifecycle(lifecycle(ALICE, POST_ID, sha256(ENV_B), DELETED));
    expect(<i32>postOrFail(POST_ID).state).toBe(DELETED);
  });

  it("rejects malformed post_id and VERSION before any cross-contract call", () => {
    Testing.authorize([ALICE]);
    LIFECYCLE = lifecycle(ALICE, filled(31, 1), VERSION, DELETED);
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("post_id must be 32 bytes");
    LIFECYCLE = lifecycle(ALICE, POST_ID, filled(31, 1), DELETED);
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("version must be 32 bytes");
    LIFECYCLE = lifecycle(ALICE, POST_ID, null, DELETED);
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("version is required");
    expect(callCount()).toBe(0);
  });

  it("treats deleted as terminal", () => {
    doLifecycle(lifecycle(ALICE, POST_ID, VERSION, DELETED, "gone"));
    expect(<i32>postOrFail(POST_ID).state).toBe(DELETED);

    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, ACTIVE);
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("post deleted");

    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, DELETED);
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("post deleted");

    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, MIGRATED, null, filled(32, 0x55));
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("post deleted");
    expect(<i32>postOrFail(POST_ID).state).toBe(DELETED);
  });

  it("requires a replacement id for migrated and superseded", () => {
    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, MIGRATED);
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("replacement_id is required");

    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, SUPERSEDED, null, filled(16, 1));
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("replacement_id must be 32 bytes");

    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, SUPERSEDED, null, POST_ID);
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("replacement_id must differ from post_id");

    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, MIGRATED, "moved", filled(32, 0x55));
    callLifecycle();
    const rec = postOrFail(POST_ID);
    expect(<i32>rec.state).toBe(MIGRATED);
    const data = Protobuf.decode<publications.lifecycle_event>(lastEvent().data, publications.lifecycle_event.decode);
    expect(<i32>data.state).toBe(MIGRATED);
    expect(data.reason!).toBe("moved");
    expect(Arrays.equal(data.replacement_id!, filled(32, 0x55))).toBe(true);
  });

  it("rejects a replacement id for other states", () => {
    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, AUTHOR_HIDDEN, null, filled(32, 0x55));
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("replacement_id not allowed for this state");
    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, DELETED, null, filled(32, 0x55));
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("replacement_id not allowed for this state");
    expect(<i32>postOrFail(POST_ID).state).toBe(ACTIVE);
  });

  it("bounds the reason and rejects unknown states", () => {
    Testing.authorize([ALICE]);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, AUTHOR_HIDDEN, "r".repeat(257));
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("reason too long");
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, 9);
    expect(() => {
      callLifecycle();
    }).toThrow();
    expectRevert("unknown lifecycle state");
    expect(callCount()).toBe(0);

    asOwner(ALICE);
    LIFECYCLE = lifecycle(ALICE, POST_ID, VERSION, AUTHOR_HIDDEN, "r".repeat(256));
    callLifecycle();
    expect(<i32>postOrFail(POST_ID).state).toBe(AUTHOR_HIDDEN);
  });
});

// ---------------------------------------------------------------------------
// react
// ---------------------------------------------------------------------------

describe("publications: react", () => {

  beforeEach(() => {
    setupConfigured();
    POST_ID = doPublish(firstPost(BOB, 1, ENV_A));
    clearTrace();
  });

  it("emits osp.publications.reaction without touching state", () => {
    asOwner(ALICE);
    REACT = react(ALICE, POST_ID, 1);
    callReact();

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.publications.reaction");
    expectImpacted(ev, [ALICE, BOB]);
    const data = Protobuf.decode<publications.reaction_event>(ev.data, publications.reaction_event.decode);
    expect(Arrays.equal(data.actor!, ALICE)).toBe(true);
    expect(Arrays.equal(data.post_id!, POST_ID)).toBe(true);
    expect(Arrays.equal(data.post_author!, BOB)).toBe(true);
    expect(data.reaction).toBe(1);
    expect(data.removed).toBe(false);
    expect(data.timestamp).toBe(T0);

    // No state: the post and the actor's sequence are unchanged.
    const rec = postOrFail(POST_ID);
    expect(rec.version_count).toBe(1);
    expect(rec.updated_at).toBe(T0);
    expect(authorState(ALICE).next_sequence).toBe(1);
    expect(authorState(ALICE).post_count).toBe(0);

    expect(callCount()).toBe(1);
    const call = resolveCallAt(0);
    expect(Arrays.equal(call.account!, ALICE)).toBe(true);
    expect(call.capability).toBe(REACT_CAP);
  });

  it("records removals and other reaction codes", () => {
    Testing.setTime(T0 + HOUR);
    asOwner(ALICE);
    REACT = react(ALICE, POST_ID, 5, true);
    callReact();
    const data = Protobuf.decode<publications.reaction_event>(lastEvent().data, publications.reaction_event.decode);
    expect(data.reaction).toBe(5);
    expect(data.removed).toBe(true);
    expect(data.timestamp).toBe(T0 + HOUR);
  });

  it("impacts only the actor when reacting to your own post", () => {
    asOwner(BOB);
    REACT = react(BOB, POST_ID, 1);
    callReact();
    expectImpacted(lastEvent(), [BOB]);
  });

  it("accepts a device signer with the react capability", () => {
    Testing.authorize([DEVICE]);
    Testing.mockResolveActor(true, DEVICE, "", 1);
    REACT = react(ALICE, POST_ID, 1);
    REACT.device = DEVICE;
    callReact();
    expect(eventCount()).toBe(1);
    const call = resolveCallAt(0);
    expect(Arrays.equal(call.device!, DEVICE)).toBe(true);
    expect(call.capability).toBe(REACT_CAP);
  });

  it("rejects a reaction code of zero and a malformed post id", () => {
    Testing.authorize([ALICE]);
    REACT = react(ALICE, POST_ID, 0);
    expect(() => {
      callReact();
    }).toThrow();
    expectRevert("reaction is required");
    REACT = react(ALICE, filled(12, 1), 1);
    expect(() => {
      callReact();
    }).toThrow();
    expectRevert("post_id must be 32 bytes");
    expect(callCount()).toBe(0);
    expect(eventCount()).toBe(0);
  });

  it("rejects a reaction to a missing post", () => {
    asOwner(ALICE);
    REACT = react(ALICE, filled(32, 0x77), 1);
    expect(() => {
      callReact();
    }).toThrow();
    expectRevert("post not found");
    expect(eventCount()).toBe(0);
  });

  it("rejects a reaction to a deleted post but allows a hidden one", () => {
    doLifecycle(lifecycle(BOB, POST_ID, sha256(ENV_A), DELETED));
    clearTrace();
    asOwner(ALICE);
    REACT = react(ALICE, POST_ID, 1);
    expect(() => {
      callReact();
    }).toThrow();
    expectRevert("post deleted");
    expect(eventCount()).toBe(0);

    const hidden = doPublish(firstPost(BOB, 2, ENV_B));
    doLifecycle(lifecycle(BOB, hidden, sha256(ENV_B), AUTHOR_HIDDEN));
    clearTrace();
    asOwner(ALICE);
    REACT = react(ALICE, hidden, 1);
    callReact();
    expect(eventCount()).toBe(1);
  });

  it("rejects a transaction not signed by the resolved signer", () => {
    Testing.authorize([CAROL]);
    Testing.mockResolveActor(true, ALICE, "", 1);
    REACT = react(ALICE, POST_ID, 1);
    expect(() => {
      callReact();
    }).toThrow();
    expectRevert("authorization failed");
    expect(eventCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// distribute_keys
// ---------------------------------------------------------------------------

describe("publications: distribute_keys", () => {
  beforeEach(() => {
    setupConfigured();
  });

  it("emits osp.publications.keys_distributed with the packages", () => {
    asOwner(ALICE);
    KEYS = keys(ALICE, filled(200, 0x88), AUDIENCE_ID, 4);
    callKeys();

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.publications.keys_distributed");
    expectImpacted(ev, [ALICE]);
    const data = Protobuf.decode<publications.keys_distributed_event>(ev.data, publications.keys_distributed_event.decode);
    expect(Arrays.equal(data.author!, ALICE)).toBe(true);
    expect(Arrays.equal(data.audience_id!, AUDIENCE_ID)).toBe(true);
    expect(data.epoch).toBe(4);
    expect(Arrays.equal(data.packages!, filled(200, 0x88))).toBe(true);
    expect(data.timestamp).toBe(T0);

    // No state is written.
    expect(authorState(ALICE).next_sequence).toBe(1);
    expect(callCount()).toBe(1);
    const call = resolveCallAt(0);
    expect(Arrays.equal(call.account!, ALICE)).toBe(true);
    expect(call.capability).toBe(PUBLISH_CAP);
  });

  it("accepts the friends audience (empty audience id)", () => {
    asOwner(ALICE);
    KEYS = keys(ALICE, filled(16, 1), null, 1);
    callKeys();
    const data = Protobuf.decode<publications.keys_distributed_event>(lastEvent().data, publications.keys_distributed_event.decode);
    expect(data.audience_id == null || data.audience_id!.length == 0).toBe(true);
    expect(data.epoch).toBe(1);
  });

  it("requires non-empty packages within the size limit", () => {
    Testing.authorize([ALICE]);
    KEYS = keys(ALICE, new Uint8Array(0));
    expect(() => {
      callKeys();
    }).toThrow();
    expectRevert("packages is required");
    KEYS = keys(ALICE, filled(MAX_PACKAGES + 1, 1));
    expect(() => {
      callKeys();
    }).toThrow();
    expectRevert("packages too large");
    expect(callCount()).toBe(0);
    expect(eventCount()).toBe(0);

    asOwner(ALICE);
    KEYS = keys(ALICE, filled(MAX_PACKAGES, 1));
    callKeys();
    const data = Protobuf.decode<publications.keys_distributed_event>(lastEvent().data, publications.keys_distributed_event.decode);
    expect(data.packages!.length).toBe(MAX_PACKAGES);
  });

  it("bounds the audience id", () => {
    Testing.authorize([ALICE]);
    KEYS = keys(ALICE, filled(16, 1), filled(33, 1));
    expect(() => {
      callKeys();
    }).toThrow();
    expectRevert("audience_id too large");
    asOwner(ALICE);
    KEYS = keys(ALICE, filled(16, 1), filled(32, 1));
    callKeys();
    expect(eventCount()).toBe(1);
  });

  it("rejects a transaction not signed by the resolved signer", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "", 1);
    KEYS = keys(ALICE, filled(16, 1));
    expect(() => {
      callKeys();
    }).toThrow();
    expectRevert("authorization failed");
    expect(eventCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// record_cross_post
// ---------------------------------------------------------------------------

describe("publications: record_cross_post", () => {

  beforeEach(() => {
    setupConfigured();
    POST_ID = doPublish(firstPost(ALICE, 1, ENV_A, EVERYONE, null, IDEM_KEY));
    clearTrace();
  });

  it("emits osp.publications.cross_post_outcome for a succeeded attempt", () => {
    asOwner(ALICE);
    CROSS = crossPost(ALICE, IDEM_KEY, "atproto", SUCCEEDED, "at://did:plc:abc/app.bsky.feed.post/1", POST_ID, MANIFEST);
    callCrossPost();

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.publications.cross_post_outcome");
    expectImpacted(ev, [ALICE]);
    const data = Protobuf.decode<publications.cross_post_outcome_event>(ev.data, publications.cross_post_outcome_event.decode);
    expect(Arrays.equal(data.author!, ALICE)).toBe(true);
    expect(Arrays.equal(data.idempotency_key!, IDEM_KEY)).toBe(true);
    expect(data.adapter!).toBe("atproto");
    expect(<i32>data.state).toBe(SUCCEEDED);
    expect(data.external_ref!).toBe("at://did:plc:abc/app.bsky.feed.post/1");
    expect(Arrays.equal(data.post_id!, POST_ID)).toBe(true);
    expect(Arrays.equal(data.manifest_hash!, MANIFEST)).toBe(true);
    expect(data.timestamp).toBe(T0);

    // No state is written.
    expect(postOrFail(POST_ID).updated_at).toBe(T0);
    expect(callCount()).toBe(1);
    const call = resolveCallAt(0);
    expect(Arrays.equal(call.account!, ALICE)).toBe(true);
    expect(call.capability).toBe(PUBLISH_CAP);
  });

  it("records a failed attempt without a post", () => {
    asOwner(ALICE);
    CROSS = crossPost(ALICE, IDEM_KEY_2, "facebook", FAILED, "");
    callCrossPost();
    const data = Protobuf.decode<publications.cross_post_outcome_event>(lastEvent().data, publications.cross_post_outcome_event.decode);
    expect(<i32>data.state).toBe(FAILED);
    expect(data.post_id == null || data.post_id!.length == 0).toBe(true);
    expect(data.manifest_hash == null || data.manifest_hash!.length == 0).toBe(true);
    expect(data.external_ref == null || data.external_ref!.length == 0).toBe(true);
  });

  it("requires a post id for a succeeded outcome", () => {
    Testing.authorize([ALICE]);
    CROSS = crossPost(ALICE, IDEM_KEY, "facebook", SUCCEEDED, "ref");
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("post_id is required for a succeeded outcome");
    expect(callCount()).toBe(0);
    // Other outcomes may reference a post or not.
    asOwner(ALICE);
    CROSS = crossPost(ALICE, IDEM_KEY, "facebook", PARTIAL, "ref", POST_ID);
    callCrossPost();
    expect(eventCount()).toBe(1);
  });

  it("rejects an unknown post, another author's post and a malformed post id", () => {
    asOwner(ALICE);
    CROSS = crossPost(ALICE, IDEM_KEY, "facebook", SUCCEEDED, "ref", filled(32, 0x99));
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("post not found");

    asOwner(BOB);
    CROSS = crossPost(BOB, IDEM_KEY, "facebook", SUCCEEDED, "ref", POST_ID);
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("author mismatch");

    Testing.authorize([ALICE]);
    CROSS = crossPost(ALICE, IDEM_KEY, "facebook", SUCCEEDED, "ref", filled(10, 1));
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("post_id must be 32 bytes");
    expect(eventCount()).toBe(0);
  });

  it("rejects an idempotency key bound to another post", () => {
    const other = doPublish(firstPost(ALICE, 2, ENV_B));
    asOwner(ALICE);
    CROSS = crossPost(ALICE, IDEM_KEY, "facebook", SUCCEEDED, "ref", other);
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("idempotency key bound to another post");
    // An unbound key may report any of the author's posts.
    asOwner(ALICE);
    CROSS = crossPost(ALICE, IDEM_KEY_2, "facebook", SUCCEEDED, "ref", other);
    callCrossPost();
    expect(eventCount()).toBe(1);
  });

  it("validates the idempotency key, adapter, external ref, manifest hash and state", () => {
    Testing.authorize([ALICE]);
    CROSS = crossPost(ALICE, null, "facebook", FAILED);
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("idempotency_key is required");

    CROSS = crossPost(ALICE, filled(33, 1), "facebook", FAILED);
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("idempotency_key too large");

    CROSS = crossPost(ALICE, IDEM_KEY, "", FAILED);
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("adapter is required");

    CROSS = crossPost(ALICE, IDEM_KEY, null, FAILED);
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("adapter is required");

    CROSS = crossPost(ALICE, IDEM_KEY, "a".repeat(65), FAILED);
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("adapter too long");

    CROSS = crossPost(ALICE, IDEM_KEY, "facebook", FAILED, "e".repeat(257));
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("external_ref too long");

    CROSS = crossPost(ALICE, IDEM_KEY, "facebook", FAILED, "", null, filled(31, 1));
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("manifest_hash must be empty or 32 bytes");

    CROSS = crossPost(ALICE, IDEM_KEY, "facebook", 9);
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("unknown outcome state");
    expect(callCount()).toBe(0);
    expect(eventCount()).toBe(0);

    // Boundary values are accepted.
    asOwner(ALICE);
    CROSS = crossPost(ALICE, filled(32, 1), "a".repeat(64), FAILED, "e".repeat(256), null, MANIFEST);
    callCrossPost();
    expect(eventCount()).toBe(1);
  });

  it("rejects a transaction not signed by the resolved signer", () => {
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, ALICE, "", 1);
    CROSS = crossPost(ALICE, IDEM_KEY, "facebook", FAILED);
    expect(() => {
      callCrossPost();
    }).toThrow();
    expectRevert("authorization failed");
    expect(eventCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe("publications: reads", () => {
  beforeEach(() => {
    setupConfigured();
  });

  it("get_post is null for unknown or empty ids", () => {
    expect(post(filled(32, 1)) == null).toBe(true);
    expect(contract.get_post(new publications.get_post_arguments(null)).value == null).toBe(true);
    expect(contract.get_post(new publications.get_post_arguments(new Uint8Array(0))).value == null).toBe(true);
  });

  it("get_author_state defaults to next_sequence 1", () => {
    const state = authorState(ALICE);
    expect(state.next_sequence).toBe(1);
    expect(state.post_count).toBe(0);
    expect(state.last_publish_at).toBe(0);
    const empty = contract.get_author_state(new publications.get_author_state_arguments(null)).value;
    expect(empty == null).toBe(false);
    expect(empty!.next_sequence).toBe(1);
  });

  it("get_post_by_idempotency_key is null for unknown keys or empty arguments", () => {
    expect(idemLookup(ALICE, IDEM_KEY) == null).toBe(true);
    expect(idemLookup(ALICE, null) == null).toBe(true);
    expect(contract.get_post_by_idempotency_key(new publications.get_post_by_idempotency_key_arguments(null, IDEM_KEY)).value == null).toBe(true);
  });

  it("reads never call other contracts", () => {
    doPublish(firstPost(ALICE, 1, ENV_A, EVERYONE, null, IDEM_KEY));
    const before = callCount();
    post(postIdFor(ALICE, 1, sha256(ENV_A)));
    authorState(ALICE);
    idemLookup(ALICE, IDEM_KEY);
    contract.get_limits(new publications.get_limits_arguments());
    dependencies();
    expect(callCount()).toBe(before);
  });
});
