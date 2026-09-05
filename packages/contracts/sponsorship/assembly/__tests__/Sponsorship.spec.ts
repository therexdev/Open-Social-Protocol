// Unit tests for the sponsorship contract (as-pect 8 + Koinos mock VM).
//
// Conventions: as-pect cannot reflect generated protobuf classes, so every
// assertion is on primitives; byte fields are compared with Arrays.equal.
// A revert rolls the mock database back to the last MockVM.commitTransaction(),
// so happy-path calls that later steps depend on are committed explicitly.
//
// The contract has no cross-contract dependency: sponsors are plain accounts
// and every write requires the sponsor's contract_call authority, which the
// tests grant with Testing.authorize([...]).
import { Arrays, Base58, MockVM, Protobuf, system_calls } from "@koinos/sdk-as";
import { Sponsorship } from "../Sponsorship";
import { sponsorship } from "../proto/sponsorship";
import { Testing } from "../common/testing";
import { Util } from "../common/util";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTRACT_ID = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu");
// Byte order of the sponsor fixtures (ascending): SPONSOR_C < SPONSOR_B < SPONSOR_A.
const SPONSOR_A = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe");
const SPONSOR_B = Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH");
const SPONSOR_C = Base58.decode("161DDwJNQyHqYJbP4C7Y8BTULrkjgC4U6g");
const USER = Base58.decode("1GXe3r3VmkKAEhj6C156jPxQC8p1xbQD2i");
const USER2 = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK");
// Any 25-byte address is a valid allowed contract id.
const PUBLICATIONS = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK");

const T0: u64 = Testing.DEFAULT_TIME;
const HOUR: u64 = 3_600_000;
const DAY: u64 = 86_400_000;

const ENDPOINT: string = "https://sponsor.example.com";
const POLICY_URI: string = "https://sponsor.example.com/.well-known/osp-sponsor.json";
const MAX_RC: u64 = 100_000_000;
const MAX_OPS: u32 = 200;
const MAX_BYTES: u32 = 4096;

const PUBLISH_ENTRY_POINT: u32 = 0x1a2b3c4d;
const REACT_ENTRY_POINT: u32 = 0x5e6f7081;

let contract!: Sponsorship;

function filled(n: i32, v: u8): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = v;
  return out;
}

function repeat(ch: string, n: i32): string {
  let out = "";
  for (let i = 0; i < n; i++) out += ch;
  return out;
}

/**
 * Deterministic 25-byte pseudo-address. Bytes stay in the printable ASCII
 * range so the mock VM's key comparator (string coercion of the encoded
 * database key) orders them exactly like the chain's byte order.
 */
function syntheticAddress(i: i32): Uint8Array {
  const out = new Uint8Array(25);
  out[0] = 0;
  out[1] = <u8>(0x21 + i / 64);
  out[2] = <u8>(0x21 + (i % 64));
  for (let j = 3; j < 25; j++) out[j] = 0x30;
  return out;
}

function allowedCall(contractId: Uint8Array | null, entryPoints: Array<u32> = []): sponsorship.allowed_call {
  return new sponsorship.allowed_call(contractId, entryPoints);
}

function allowedList(n: i32): Array<sponsorship.allowed_call> {
  const out: Array<sponsorship.allowed_call> = [];
  for (let i = 0; i < n; i++) out.push(allowedCall(PUBLICATIONS, [<u32>i]));
  return out;
}

function entryPoints(n: i32): Array<u32> {
  const out: Array<u32> = [];
  for (let i = 0; i < n; i++) out.push(<u32>(i + 1));
  return out;
}

/** n distinct entry points near u32.MAX (five-byte varints: the largest encoding). */
function entryPointsMax(n: i32): Array<u32> {
  const out: Array<u32> = [];
  for (let i = 0; i < n; i++) out.push(<u32>(0xffffffff - i));
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
  contract = new Sponsorship();
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

// ---------------------------------------------------------------------------
// Argument builders and contract call wrappers (module-level so they can be
// used inside the closures passed to expect(...).toThrow())
// ---------------------------------------------------------------------------

function sponsorArgs(
  sponsor: Uint8Array | null,
  endpoint: string | null = ENDPOINT,
  policyUri: string | null = POLICY_URI,
  allowed: Array<sponsorship.allowed_call> = [],
  maxBytes: u32 = MAX_BYTES,
  active: bool = true,
  policyVersion: u32 = 1
): sponsorship.set_sponsor_arguments {
  return new sponsorship.set_sponsor_arguments(
    sponsor,
    endpoint,
    policyUri,
    policyVersion,
    allowed,
    MAX_RC,
    MAX_OPS,
    maxBytes,
    active
  );
}

function grantArgs(
  sponsor: Uint8Array | null,
  user: Uint8Array | null,
  dailyOps: u32 = 50,
  expiresAt: u64 = 0
): sponsorship.set_user_grant_arguments {
  return new sponsorship.set_user_grant_arguments(sponsor, user, dailyOps, expiresAt);
}

// Pending arguments consumed by the revert helpers below (closures cannot
// capture locals in AssemblyScript, so the arguments live at module level).
let pendingSetSponsor: sponsorship.set_sponsor_arguments = new sponsorship.set_sponsor_arguments();
let pendingDeactivate: sponsorship.deactivate_sponsor_arguments = new sponsorship.deactivate_sponsor_arguments();
let pendingSetGrant: sponsorship.set_user_grant_arguments = new sponsorship.set_user_grant_arguments();
let pendingRevoke: sponsorship.revoke_user_grant_arguments = new sponsorship.revoke_user_grant_arguments();

function expectSetSponsorRevert(args: sponsorship.set_sponsor_arguments, substr: string): void {
  pendingSetSponsor = args;
  expect(() => {
    contract.set_sponsor(pendingSetSponsor);
  }).toThrow();
  expectRevert(substr);
}

function expectDeactivateRevert(sponsor: Uint8Array | null, substr: string): void {
  pendingDeactivate = new sponsorship.deactivate_sponsor_arguments(sponsor);
  expect(() => {
    contract.deactivate_sponsor(pendingDeactivate);
  }).toThrow();
  expectRevert(substr);
}

function expectSetGrantRevert(args: sponsorship.set_user_grant_arguments, substr: string): void {
  pendingSetGrant = args;
  expect(() => {
    contract.set_user_grant(pendingSetGrant);
  }).toThrow();
  expectRevert(substr);
}

function expectRevokeRevert(sponsor: Uint8Array | null, user: Uint8Array | null, substr: string): void {
  pendingRevoke = new sponsorship.revoke_user_grant_arguments(sponsor, user);
  expect(() => {
    contract.revoke_user_grant(pendingRevoke);
  }).toThrow();
  expectRevert(substr);
}

// Committed happy-path steps used as fixtures by later assertions.

function registerSponsor(sponsor: Uint8Array, active: bool = true): void {
  Testing.authorize([sponsor]);
  contract.set_sponsor(sponsorArgs(sponsor, ENDPOINT, POLICY_URI, [], MAX_BYTES, active));
  MockVM.commitTransaction();
}

function deactivate(sponsor: Uint8Array): void {
  Testing.authorize([sponsor]);
  contract.deactivate_sponsor(new sponsorship.deactivate_sponsor_arguments(sponsor));
  MockVM.commitTransaction();
}

function grant(sponsor: Uint8Array, user: Uint8Array, dailyOps: u32 = 50, expiresAt: u64 = 0): void {
  Testing.authorize([sponsor]);
  contract.set_user_grant(grantArgs(sponsor, user, dailyOps, expiresAt));
  MockVM.commitTransaction();
}

function revoke(sponsor: Uint8Array, user: Uint8Array): void {
  Testing.authorize([sponsor]);
  contract.revoke_user_grant(new sponsorship.revoke_user_grant_arguments(sponsor, user));
  MockVM.commitTransaction();
}

// Reads.

function sponsorOf(sponsor: Uint8Array | null): sponsorship.sponsor_record | null {
  return contract.get_sponsor(new sponsorship.get_sponsor_arguments(sponsor)).value;
}

function sponsorOrFail(sponsor: Uint8Array): sponsorship.sponsor_record {
  const rec = sponsorOf(sponsor);
  expect(rec == null).toBe(false, "sponsor record missing");
  return rec!;
}

function grantOf(sponsor: Uint8Array | null, user: Uint8Array | null): sponsorship.user_grant | null {
  return contract.get_user_grant(new sponsorship.get_user_grant_arguments(sponsor, user)).value;
}

function grantOrFail(sponsor: Uint8Array, user: Uint8Array): sponsorship.user_grant {
  const g = grantOf(sponsor, user);
  expect(g == null).toBe(false, "grant missing");
  return g!;
}

function list(start: Uint8Array | null, limit: u32): Array<sponsorship.sponsor_record> {
  return contract.list_sponsors(new sponsorship.list_sponsors_arguments(start, limit)).values;
}

function expectListed(values: Array<sponsorship.sponsor_record>, expected: Uint8Array[]): void {
  expect(values.length).toBe(expected.length, "listed count");
  for (let i = 0; i < expected.length; i++) {
    expect(Arrays.equal(values[i].sponsor!, expected[i])).toBe(true, "values[" + i.toString() + "]");
  }
}

// ---------------------------------------------------------------------------
// set_sponsor
// ---------------------------------------------------------------------------

describe("sponsorship: set_sponsor", () => {
  beforeEach(() => {
    setup();
  });

  it("registers a new sponsor and emits osp.sponsorship.sponsor_set", () => {
    Testing.authorize([SPONSOR_A]);
    const allowed = [
      allowedCall(PUBLICATIONS, [PUBLISH_ENTRY_POINT, REACT_ENTRY_POINT]),
      allowedCall(SPONSOR_B, []),
    ];
    contract.set_sponsor(sponsorArgs(SPONSOR_A, ENDPOINT, POLICY_URI, allowed, MAX_BYTES, true, 3));

    const rec = sponsorOrFail(SPONSOR_A);
    expect(Arrays.equal(rec.sponsor!, SPONSOR_A)).toBe(true);
    expect(rec.endpoint!).toBe(ENDPOINT);
    expect(rec.policy_uri!).toBe(POLICY_URI);
    expect(rec.policy_version).toBe(3);
    expect(rec.max_rc_per_op).toBe(MAX_RC);
    expect(rec.max_ops_per_user_per_day).toBe(MAX_OPS);
    expect(rec.max_bytes_per_op).toBe(MAX_BYTES);
    expect(rec.active).toBe(true);
    expect(rec.registered_at).toBe(T0);
    expect(rec.updated_at).toBe(T0);

    expect(rec.allowed.length).toBe(2);
    expect(Arrays.equal(rec.allowed[0].contract_id!, PUBLICATIONS)).toBe(true);
    expect(rec.allowed[0].entry_points.length).toBe(2);
    expect(rec.allowed[0].entry_points[0]).toBe(PUBLISH_ENTRY_POINT);
    expect(rec.allowed[0].entry_points[1]).toBe(REACT_ENTRY_POINT);
    expect(Arrays.equal(rec.allowed[1].contract_id!, SPONSOR_B)).toBe(true);
    expect(rec.allowed[1].entry_points.length).toBe(0);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.sponsorship.sponsor_set");
    expectImpacted(ev, [SPONSOR_A]);
    const data = Protobuf.decode<sponsorship.sponsor_set_event>(ev.data, sponsorship.sponsor_set_event.decode);
    expect(Arrays.equal(data.sponsor!, SPONSOR_A)).toBe(true);
    expect(data.endpoint!).toBe(ENDPOINT);
    expect(data.policy_version).toBe(3);
    expect(data.active).toBe(true);
    expect(data.timestamp).toBe(T0);
  });

  it("updates an existing sponsor and keeps registered_at", () => {
    registerSponsor(SPONSOR_A);
    clearEvents();

    Testing.setTime(T0 + HOUR);
    Testing.authorize([SPONSOR_A]);
    const newEndpoint = "https://v2.sponsor.example.com/api";
    contract.set_sponsor(
      sponsorArgs(SPONSOR_A, newEndpoint, "", [allowedCall(PUBLICATIONS, [PUBLISH_ENTRY_POINT])], 1024, false, 2)
    );

    const rec = sponsorOrFail(SPONSOR_A);
    expect(rec.endpoint!).toBe(newEndpoint);
    expect(rec.policy_uri!).toBe("");
    expect(rec.policy_version).toBe(2);
    expect(rec.max_bytes_per_op).toBe(1024);
    expect(rec.active).toBe(false);
    expect(rec.allowed.length).toBe(1);
    expect(rec.registered_at).toBe(T0, "registered_at is preserved");
    expect(rec.updated_at).toBe(T0 + HOUR);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.sponsorship.sponsor_set");
    const data = Protobuf.decode<sponsorship.sponsor_set_event>(ev.data, sponsorship.sponsor_set_event.decode);
    expect(data.endpoint!).toBe(newEndpoint);
    expect(data.policy_version).toBe(2);
    expect(data.active).toBe(false);
    expect(data.timestamp).toBe(T0 + HOUR);
  });

  it("can register an inactive sponsor and re-activate it later", () => {
    registerSponsor(SPONSOR_A, false);
    expect(sponsorOrFail(SPONSOR_A).active).toBe(false);

    Testing.setTime(T0 + DAY);
    Testing.authorize([SPONSOR_A]);
    contract.set_sponsor(sponsorArgs(SPONSOR_A));
    const rec = sponsorOrFail(SPONSOR_A);
    expect(rec.active).toBe(true);
    expect(rec.registered_at).toBe(T0);
    expect(rec.updated_at).toBe(T0 + DAY);
  });

  it("rejects a signer other than the sponsor", () => {
    Testing.authorize([SPONSOR_B]);
    expectSetSponsorRevert(sponsorArgs(SPONSOR_A), "authorization failed");
    expect(sponsorOf(SPONSOR_A) == null).toBe(true);
    expect(eventCount()).toBe(0);
  });

  it("rejects an update signed by someone other than the sponsor", () => {
    registerSponsor(SPONSOR_A);
    Testing.authorize([SPONSOR_B, USER]);
    expectSetSponsorRevert(sponsorArgs(SPONSOR_A, ENDPOINT, POLICY_URI, [], MAX_BYTES, false, 9), "authorization failed");
    const rec = sponsorOrFail(SPONSOR_A);
    expect(rec.policy_version).toBe(1);
    expect(rec.active).toBe(true);
  });

  it("rejects a malformed sponsor address", () => {
    Testing.authorize([SPONSOR_A]);
    expectSetSponsorRevert(sponsorArgs(filled(10, 1)), "sponsor must be a 25-byte address");
    expectSetSponsorRevert(sponsorArgs(null), "sponsor is required");
    expectSetSponsorRevert(sponsorArgs(new Uint8Array(0)), "sponsor is required");
  });

  it("accepts an empty endpoint and https / localhost endpoints", () => {
    Testing.authorize([SPONSOR_A]);
    contract.set_sponsor(sponsorArgs(SPONSOR_A, ""));
    expect(sponsorOrFail(SPONSOR_A).endpoint!).toBe("");
    contract.set_sponsor(sponsorArgs(SPONSOR_A, null));
    expect(sponsorOrFail(SPONSOR_A).endpoint!).toBe("");
    contract.set_sponsor(sponsorArgs(SPONSOR_A, "https://a.b/c?d=e"));
    expect(sponsorOrFail(SPONSOR_A).endpoint!).toBe("https://a.b/c?d=e");
    contract.set_sponsor(sponsorArgs(SPONSOR_A, "http://localhost"));
    expect(sponsorOrFail(SPONSOR_A).endpoint!).toBe("http://localhost");
    contract.set_sponsor(sponsorArgs(SPONSOR_A, "http://localhost:8787/v1"));
    expect(sponsorOrFail(SPONSOR_A).endpoint!).toBe("http://localhost:8787/v1");
    contract.set_sponsor(sponsorArgs(SPONSOR_A, "http://localhost/sponsor"));
    expect(sponsorOrFail(SPONSOR_A).endpoint!).toBe("http://localhost/sponsor");
  });

  it("rejects non-https endpoints", () => {
    Testing.authorize([SPONSOR_A]);
    expectSetSponsorRevert(sponsorArgs(SPONSOR_A, "http://sponsor.example.com"), "endpoint must use https");
    expectSetSponsorRevert(sponsorArgs(SPONSOR_A, "ftp://sponsor.example.com"), "endpoint must use https");
    expectSetSponsorRevert(sponsorArgs(SPONSOR_A, "sponsor.example.com"), "endpoint must use https");
    expectSetSponsorRevert(sponsorArgs(SPONSOR_A, "https:/sponsor.example.com"), "endpoint must use https");
    expectSetSponsorRevert(sponsorArgs(SPONSOR_A, "HTTPS://sponsor.example.com"), "endpoint must use https");
    expectSetSponsorRevert(sponsorArgs(SPONSOR_A, "http://localhost.example.com"), "endpoint must use https");
    expectSetSponsorRevert(sponsorArgs(SPONSOR_A, "http://localhostx"), "endpoint must use https");
    expect(sponsorOf(SPONSOR_A) == null).toBe(true);
  });

  it("enforces the endpoint and policy_uri length limits", () => {
    Testing.authorize([SPONSOR_A]);
    const longestEndpoint = "https://" + repeat("a", 256 - 8);
    contract.set_sponsor(sponsorArgs(SPONSOR_A, longestEndpoint));
    expect(sponsorOrFail(SPONSOR_A).endpoint!.length).toBe(256);
    expectSetSponsorRevert(sponsorArgs(SPONSOR_A, longestEndpoint + "a"), "endpoint too long");

    const longestPolicy = repeat("p", 256);
    contract.set_sponsor(sponsorArgs(SPONSOR_A, ENDPOINT, longestPolicy));
    expect(sponsorOrFail(SPONSOR_A).policy_uri!.length).toBe(256);
    expectSetSponsorRevert(sponsorArgs(SPONSOR_A, ENDPOINT, longestPolicy + "p"), "policy_uri too long");
  });

  it("enforces the allowed-call list limits", () => {
    Testing.authorize([SPONSOR_A]);
    contract.set_sponsor(sponsorArgs(SPONSOR_A, ENDPOINT, POLICY_URI, allowedList(32)));
    expect(sponsorOrFail(SPONSOR_A).allowed.length).toBe(32);
    expectSetSponsorRevert(sponsorArgs(SPONSOR_A, ENDPOINT, POLICY_URI, allowedList(33)), "too many allowed calls");

    contract.set_sponsor(sponsorArgs(SPONSOR_A, ENDPOINT, POLICY_URI, [allowedCall(PUBLICATIONS, entryPoints(64))]));
    expect(sponsorOrFail(SPONSOR_A).allowed[0].entry_points.length).toBe(64);
    expectSetSponsorRevert(
      sponsorArgs(SPONSOR_A, ENDPOINT, POLICY_URI, [allowedCall(PUBLICATIONS, entryPoints(65))]),
      "too many entry points"
    );

    expectSetSponsorRevert(
      sponsorArgs(SPONSOR_A, ENDPOINT, POLICY_URI, [allowedCall(filled(24, 7), [])]),
      "allowed contract_id must be a 25-byte address"
    );
    expectSetSponsorRevert(
      sponsorArgs(SPONSOR_A, ENDPOINT, POLICY_URI, [allowedCall(PUBLICATIONS, []), allowedCall(null, [1])]),
      "allowed contract_id is required"
    );
  });

  it("enforces the max_bytes_per_op ceiling", () => {
    Testing.authorize([SPONSOR_A]);
    contract.set_sponsor(sponsorArgs(SPONSOR_A, ENDPOINT, POLICY_URI, [], 65536));
    expect(sponsorOrFail(SPONSOR_A).max_bytes_per_op).toBe(65536);
    contract.set_sponsor(sponsorArgs(SPONSOR_A, ENDPOINT, POLICY_URI, [], 0));
    expect(sponsorOrFail(SPONSOR_A).max_bytes_per_op).toBe(0);
    expectSetSponsorRevert(sponsorArgs(SPONSOR_A, ENDPOINT, POLICY_URI, [], 65537), "max_bytes_per_op too large");
  });

  it("round-trips a maximum-size record through get_sponsor and list_sponsors", () => {
    // 32 allowed calls x 64 five-byte entry points, plus two 256-character
    // URIs (the policy URI using 3-byte UTF-8 characters): far beyond the
    // SDK's default 1 KiB system-call buffer, which the contract enlarges.
    Testing.authorize([SPONSOR_A]);
    const allowed: Array<sponsorship.allowed_call> = [];
    for (let i = 0; i < 32; i++) allowed.push(allowedCall(PUBLICATIONS, entryPointsMax(64)));
    const endpoint = "https://" + repeat("e", 248);
    const policy = repeat("中", 256);
    contract.set_sponsor(sponsorArgs(SPONSOR_A, endpoint, policy, allowed, 65536, true, 4_000_000_000));

    const rec = sponsorOrFail(SPONSOR_A);
    expect(rec.endpoint!.length).toBe(256);
    expect(rec.policy_uri!.length).toBe(256);
    expect(rec.policy_uri!).toBe(policy);
    expect(rec.policy_version).toBe(4_000_000_000);
    expect(rec.max_bytes_per_op).toBe(65536);
    expect(rec.allowed.length).toBe(32);
    expect(rec.allowed[31].entry_points.length).toBe(64);
    expect(rec.allowed[31].entry_points[0]).toBe(0xffffffff);
    expect(rec.allowed[31].entry_points[63]).toBe(0xffffffff - 63);

    const listed = list(null, 1);
    expect(listed.length).toBe(1);
    expect(listed[0].allowed.length).toBe(32);
    expect(listed[0].allowed[0].entry_points.length).toBe(64);
    expect(listed[0].endpoint!).toBe(endpoint);

    const ev = lastEvent();
    const data = Protobuf.decode<sponsorship.sponsor_set_event>(ev.data, sponsorship.sponsor_set_event.decode);
    expect(data.endpoint!).toBe(endpoint);
  });

  it("keeps sponsors independent of each other", () => {
    registerSponsor(SPONSOR_A);
    registerSponsor(SPONSOR_B, false);
    expect(sponsorOrFail(SPONSOR_A).active).toBe(true);
    expect(sponsorOrFail(SPONSOR_B).active).toBe(false);
    expect(sponsorOf(SPONSOR_C) == null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deactivate_sponsor
// ---------------------------------------------------------------------------

describe("sponsorship: deactivate_sponsor", () => {
  beforeEach(() => {
    setup();
  });

  it("deactivates a sponsor and emits osp.sponsorship.sponsor_deactivated", () => {
    Testing.authorize([SPONSOR_A]);
    contract.set_sponsor(sponsorArgs(SPONSOR_A, ENDPOINT, POLICY_URI, allowedList(2), MAX_BYTES, true, 5));
    MockVM.commitTransaction();
    clearEvents();

    Testing.setTime(T0 + HOUR);
    contract.deactivate_sponsor(new sponsorship.deactivate_sponsor_arguments(SPONSOR_A));

    const rec = sponsorOrFail(SPONSOR_A);
    expect(rec.active).toBe(false);
    expect(rec.updated_at).toBe(T0 + HOUR);
    // Everything else is preserved.
    expect(rec.registered_at).toBe(T0);
    expect(rec.endpoint!).toBe(ENDPOINT);
    expect(rec.policy_uri!).toBe(POLICY_URI);
    expect(rec.policy_version).toBe(5);
    expect(rec.allowed.length).toBe(2);
    expect(rec.max_rc_per_op).toBe(MAX_RC);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.sponsorship.sponsor_deactivated");
    expectImpacted(ev, [SPONSOR_A]);
    const data = Protobuf.decode<sponsorship.sponsor_deactivated_event>(
      ev.data,
      sponsorship.sponsor_deactivated_event.decode
    );
    expect(Arrays.equal(data.sponsor!, SPONSOR_A)).toBe(true);
    expect(data.timestamp).toBe(T0 + HOUR);
  });

  it("is idempotent for an already inactive sponsor", () => {
    registerSponsor(SPONSOR_A);
    deactivate(SPONSOR_A);
    clearEvents();
    Testing.setTime(T0 + DAY);
    contract.deactivate_sponsor(new sponsorship.deactivate_sponsor_arguments(SPONSOR_A));
    const rec = sponsorOrFail(SPONSOR_A);
    expect(rec.active).toBe(false);
    expect(rec.updated_at).toBe(T0 + DAY);
    expect(lastEvent().name).toBe("osp.sponsorship.sponsor_deactivated");
  });

  it("rejects an unregistered sponsor", () => {
    Testing.authorize([SPONSOR_A]);
    expectDeactivateRevert(SPONSOR_A, "sponsor not registered");
    expect(eventCount()).toBe(0);
  });

  it("rejects a signer other than the sponsor", () => {
    registerSponsor(SPONSOR_A);
    Testing.authorize([SPONSOR_B]);
    expectDeactivateRevert(SPONSOR_A, "authorization failed");
    expect(sponsorOrFail(SPONSOR_A).active).toBe(true);
  });

  it("rejects a malformed address", () => {
    Testing.authorize([SPONSOR_A]);
    expectDeactivateRevert(filled(25, 0).subarray(0, 3), "sponsor must be a 25-byte address");
    expectDeactivateRevert(null, "sponsor is required");
  });

  it("does not touch other sponsors", () => {
    registerSponsor(SPONSOR_A);
    registerSponsor(SPONSOR_B);
    deactivate(SPONSOR_A);
    expect(sponsorOrFail(SPONSOR_A).active).toBe(false);
    expect(sponsorOrFail(SPONSOR_B).active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// set_user_grant
// ---------------------------------------------------------------------------

describe("sponsorship: set_user_grant", () => {
  beforeEach(() => {
    setup();
    registerSponsor(SPONSOR_A);
    clearEvents();
  });

  it("creates a grant and emits osp.sponsorship.user_grant_set", () => {
    Testing.authorize([SPONSOR_A]);
    contract.set_user_grant(grantArgs(SPONSOR_A, USER, 25, T0 + DAY));

    const g = grantOrFail(SPONSOR_A, USER);
    expect(Arrays.equal(g.sponsor!, SPONSOR_A)).toBe(true);
    expect(Arrays.equal(g.user!, USER)).toBe(true);
    expect(g.daily_ops).toBe(25);
    expect(g.expires_at).toBe(T0 + DAY);
    expect(g.revoked).toBe(false);
    expect(g.updated_at).toBe(T0);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.sponsorship.user_grant_set");
    expectImpacted(ev, [SPONSOR_A, USER]);
    const data = Protobuf.decode<sponsorship.user_grant_set_event>(ev.data, sponsorship.user_grant_set_event.decode);
    expect(Arrays.equal(data.sponsor!, SPONSOR_A)).toBe(true);
    expect(Arrays.equal(data.user!, USER)).toBe(true);
    expect(data.daily_ops).toBe(25);
    expect(data.expires_at).toBe(T0 + DAY);
    expect(data.timestamp).toBe(T0);
  });

  it("accepts expires_at = 0 (no expiry) and a future expiry, rejects now or the past", () => {
    Testing.authorize([SPONSOR_A]);
    contract.set_user_grant(grantArgs(SPONSOR_A, USER, 1, 0));
    expect(grantOrFail(SPONSOR_A, USER).expires_at).toBe(0);
    contract.set_user_grant(grantArgs(SPONSOR_A, USER, 1, T0 + 1));
    expect(grantOrFail(SPONSOR_A, USER).expires_at).toBe(T0 + 1);
    MockVM.commitTransaction();

    expectSetGrantRevert(grantArgs(SPONSOR_A, USER2, 1, T0), "expires_at must be 0 or in the future");
    expectSetGrantRevert(grantArgs(SPONSOR_A, USER2, 1, T0 - 1), "expires_at must be 0 or in the future");
    expect(grantOf(SPONSOR_A, USER2) == null).toBe(true);

    // The clock moves: an expiry that was valid earlier is now rejected.
    Testing.setTime(T0 + DAY);
    expectSetGrantRevert(grantArgs(SPONSOR_A, USER2, 1, T0 + 1), "expires_at must be 0 or in the future");
    contract.set_user_grant(grantArgs(SPONSOR_A, USER2, 1, T0 + DAY + 1));
    expect(grantOrFail(SPONSOR_A, USER2).expires_at).toBe(T0 + DAY + 1);
  });

  it("rejects daily_ops = 0", () => {
    Testing.authorize([SPONSOR_A]);
    expectSetGrantRevert(grantArgs(SPONSOR_A, USER, 0, 0), "daily_ops must be at least 1");
    expect(grantOf(SPONSOR_A, USER) == null).toBe(true);
    expect(eventCount()).toBe(0);
  });

  it("rejects a grant to the sponsor itself", () => {
    Testing.authorize([SPONSOR_A]);
    expectSetGrantRevert(grantArgs(SPONSOR_A, SPONSOR_A, 10, 0), "user must differ from sponsor");
  });

  it("rejects malformed addresses", () => {
    Testing.authorize([SPONSOR_A]);
    expectSetGrantRevert(grantArgs(filled(5, 1), USER, 10, 0), "sponsor must be a 25-byte address");
    expectSetGrantRevert(grantArgs(null, USER, 10, 0), "sponsor is required");
    expectSetGrantRevert(grantArgs(SPONSOR_A, filled(26, 1), 10, 0), "user must be a 25-byte address");
    expectSetGrantRevert(grantArgs(SPONSOR_A, null, 10, 0), "user is required");
  });

  it("rejects a signer other than the sponsor", () => {
    Testing.authorize([USER, SPONSOR_B]);
    expectSetGrantRevert(grantArgs(SPONSOR_A, USER, 10, 0), "authorization failed");
    expect(grantOf(SPONSOR_A, USER) == null).toBe(true);
  });

  it("rejects an unregistered sponsor", () => {
    Testing.authorize([SPONSOR_B]);
    expectSetGrantRevert(grantArgs(SPONSOR_B, USER, 10, 0), "sponsor not registered");
    expect(grantOf(SPONSOR_B, USER) == null).toBe(true);
  });

  it("rejects an inactive sponsor until it is re-activated", () => {
    deactivate(SPONSOR_A);
    Testing.authorize([SPONSOR_A]);
    expectSetGrantRevert(grantArgs(SPONSOR_A, USER, 10, 0), "sponsor inactive");
    expect(grantOf(SPONSOR_A, USER) == null).toBe(true);

    // A sponsor registered as inactive is rejected the same way.
    registerSponsor(SPONSOR_B, false);
    Testing.authorize([SPONSOR_B]);
    expectSetGrantRevert(grantArgs(SPONSOR_B, USER, 10, 0), "sponsor inactive");

    // Re-activation through set_sponsor makes grants possible again.
    registerSponsor(SPONSOR_A, true);
    Testing.authorize([SPONSOR_A]);
    contract.set_user_grant(grantArgs(SPONSOR_A, USER, 10, 0));
    expect(grantOrFail(SPONSOR_A, USER).daily_ops).toBe(10);
  });

  it("updates an existing grant and clears a revocation", () => {
    grant(SPONSOR_A, USER, 10, T0 + DAY);
    revoke(SPONSOR_A, USER);
    expect(grantOrFail(SPONSOR_A, USER).revoked).toBe(true);
    clearEvents();

    Testing.setTime(T0 + HOUR);
    Testing.authorize([SPONSOR_A]);
    contract.set_user_grant(grantArgs(SPONSOR_A, USER, 99, 0));

    const g = grantOrFail(SPONSOR_A, USER);
    expect(g.daily_ops).toBe(99);
    expect(g.expires_at).toBe(0);
    expect(g.revoked).toBe(false);
    expect(g.updated_at).toBe(T0 + HOUR);
    expect(eventCount()).toBe(1);
    expect(lastEvent().name).toBe("osp.sponsorship.user_grant_set");
  });

  it("scopes grants per (sponsor, user) pair", () => {
    registerSponsor(SPONSOR_B);
    grant(SPONSOR_A, USER, 10, 0);
    grant(SPONSOR_B, USER, 20, 0);
    grant(SPONSOR_A, USER2, 30, 0);

    expect(grantOrFail(SPONSOR_A, USER).daily_ops).toBe(10);
    expect(grantOrFail(SPONSOR_B, USER).daily_ops).toBe(20);
    expect(grantOrFail(SPONSOR_A, USER2).daily_ops).toBe(30);
    expect(grantOf(SPONSOR_B, USER2) == null).toBe(true);
    // The key is sponsor || user, never user || sponsor.
    expect(grantOf(USER, SPONSOR_A) == null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// revoke_user_grant
// ---------------------------------------------------------------------------

describe("sponsorship: revoke_user_grant", () => {
  beforeEach(() => {
    setup();
    registerSponsor(SPONSOR_A);
    grant(SPONSOR_A, USER, 40, T0 + DAY);
    clearEvents();
  });

  it("revokes a grant and emits osp.sponsorship.user_grant_revoked", () => {
    Testing.setTime(T0 + HOUR);
    Testing.authorize([SPONSOR_A]);
    contract.revoke_user_grant(new sponsorship.revoke_user_grant_arguments(SPONSOR_A, USER));

    const g = grantOrFail(SPONSOR_A, USER);
    expect(g.revoked).toBe(true);
    expect(g.updated_at).toBe(T0 + HOUR);
    // Everything else is preserved.
    expect(g.daily_ops).toBe(40);
    expect(g.expires_at).toBe(T0 + DAY);
    expect(Arrays.equal(g.sponsor!, SPONSOR_A)).toBe(true);
    expect(Arrays.equal(g.user!, USER)).toBe(true);

    expect(eventCount()).toBe(1);
    const ev = lastEvent();
    expect(ev.name).toBe("osp.sponsorship.user_grant_revoked");
    expectImpacted(ev, [SPONSOR_A, USER]);
    const data = Protobuf.decode<sponsorship.user_grant_revoked_event>(
      ev.data,
      sponsorship.user_grant_revoked_event.decode
    );
    expect(Arrays.equal(data.sponsor!, SPONSOR_A)).toBe(true);
    expect(Arrays.equal(data.user!, USER)).toBe(true);
    expect(data.timestamp).toBe(T0 + HOUR);
  });

  it("is idempotent for an already revoked grant", () => {
    revoke(SPONSOR_A, USER);
    clearEvents();
    Testing.setTime(T0 + DAY);
    contract.revoke_user_grant(new sponsorship.revoke_user_grant_arguments(SPONSOR_A, USER));
    const g = grantOrFail(SPONSOR_A, USER);
    expect(g.revoked).toBe(true);
    expect(g.updated_at).toBe(T0 + DAY);
    expect(lastEvent().name).toBe("osp.sponsorship.user_grant_revoked");
  });

  it("still works after the sponsor was deactivated", () => {
    deactivate(SPONSOR_A);
    Testing.authorize([SPONSOR_A]);
    contract.revoke_user_grant(new sponsorship.revoke_user_grant_arguments(SPONSOR_A, USER));
    expect(grantOrFail(SPONSOR_A, USER).revoked).toBe(true);
  });

  it("rejects a missing grant", () => {
    Testing.authorize([SPONSOR_A]);
    expectRevokeRevert(SPONSOR_A, USER2, "grant not found");
    // A grant from another sponsor is a different key.
    registerSponsor(SPONSOR_B);
    Testing.authorize([SPONSOR_B]);
    expectRevokeRevert(SPONSOR_B, USER, "grant not found");
    expect(grantOrFail(SPONSOR_A, USER).revoked).toBe(false);
  });

  it("rejects a signer other than the sponsor", () => {
    Testing.authorize([USER]);
    expectRevokeRevert(SPONSOR_A, USER, "authorization failed");
    expect(grantOrFail(SPONSOR_A, USER).revoked).toBe(false);
    expect(eventCount()).toBe(0);
  });

  it("rejects malformed addresses", () => {
    Testing.authorize([SPONSOR_A]);
    expectRevokeRevert(filled(2, 1), USER, "sponsor must be a 25-byte address");
    expectRevokeRevert(SPONSOR_A, filled(30, 1), "user must be a 25-byte address");
    expectRevokeRevert(SPONSOR_A, null, "user is required");
  });
});

// ---------------------------------------------------------------------------
// Reads: get_sponsor / get_user_grant / list_sponsors
// ---------------------------------------------------------------------------

describe("sponsorship: reads", () => {
  beforeEach(() => {
    setup();
  });

  it("get_sponsor returns null for unknown or empty sponsors", () => {
    expect(sponsorOf(SPONSOR_A) == null).toBe(true);
    expect(sponsorOf(null) == null).toBe(true);
    expect(sponsorOf(new Uint8Array(0)) == null).toBe(true);
    expect(sponsorOf(filled(3, 1)) == null).toBe(true);
    registerSponsor(SPONSOR_A);
    expect(sponsorOf(SPONSOR_A) == null).toBe(false);
    expect(sponsorOf(SPONSOR_B) == null).toBe(true);
  });

  it("get_user_grant returns null for unknown or empty pairs", () => {
    expect(grantOf(SPONSOR_A, USER) == null).toBe(true);
    expect(grantOf(null, USER) == null).toBe(true);
    expect(grantOf(SPONSOR_A, null) == null).toBe(true);
    expect(grantOf(new Uint8Array(0), USER) == null).toBe(true);
    registerSponsor(SPONSOR_A);
    grant(SPONSOR_A, USER, 5, 0);
    expect(grantOf(SPONSOR_A, USER) == null).toBe(false);
    expect(grantOf(SPONSOR_A, USER2) == null).toBe(true);
  });

  it("list_sponsors is empty when nothing is registered", () => {
    expect(list(null, 10).length).toBe(0);
    expect(list(null, 0).length).toBe(0);
    expect(list(SPONSOR_A, 10).length).toBe(0);
  });

  it("list_sponsors returns records in ascending address order regardless of insertion order", () => {
    // Fixture byte order: SPONSOR_C < SPONSOR_B < SPONSOR_A (see Util.compare below).
    expect(Util.compare(SPONSOR_C, SPONSOR_B) < 0).toBe(true);
    expect(Util.compare(SPONSOR_B, SPONSOR_A) < 0).toBe(true);

    registerSponsor(SPONSOR_A);
    registerSponsor(SPONSOR_C);
    registerSponsor(SPONSOR_B, false);

    const values = list(null, 10);
    expectListed(values, [SPONSOR_C, SPONSOR_B, SPONSOR_A]);
    // Full records are returned, inactive sponsors included.
    expect(values[0].active).toBe(true);
    expect(values[1].active).toBe(false);
    expect(values[2].endpoint!).toBe(ENDPOINT);
    expect(values[2].registered_at).toBe(T0);

    // An empty start behaves like a missing one.
    expectListed(list(new Uint8Array(0), 10), [SPONSOR_C, SPONSOR_B, SPONSOR_A]);
  });

  it("list_sponsors pages with an exclusive start cursor", () => {
    registerSponsor(SPONSOR_A);
    registerSponsor(SPONSOR_B);
    registerSponsor(SPONSOR_C);

    const page1 = list(null, 2);
    expectListed(page1, [SPONSOR_C, SPONSOR_B]);
    const page2 = list(page1[page1.length - 1].sponsor, 2);
    expectListed(page2, [SPONSOR_A]);
    expectListed(list(SPONSOR_A, 2), []);

    // A start that is not itself registered still works as a lower bound.
    expect(Util.compare(CONTRACT_ID, SPONSOR_C) < 0).toBe(true);
    expectListed(list(CONTRACT_ID, 10), [SPONSOR_C, SPONSOR_B, SPONSOR_A]);
    expect(Util.compare(USER, SPONSOR_A) > 0).toBe(true);
    expectListed(list(USER, 10), []);
  });

  it("list_sponsors treats limit 0 as the maximum page and honours small limits", () => {
    registerSponsor(SPONSOR_A);
    registerSponsor(SPONSOR_B);
    registerSponsor(SPONSOR_C);
    expectListed(list(null, 0), [SPONSOR_C, SPONSOR_B, SPONSOR_A]);
    expectListed(list(null, 1), [SPONSOR_C]);
    expectListed(list(SPONSOR_C, 1), [SPONSOR_B]);
    expectListed(list(null, 3), [SPONSOR_C, SPONSOR_B, SPONSOR_A]);
    expectListed(list(null, 4_000_000_000), [SPONSOR_C, SPONSOR_B, SPONSOR_A]);
  });

  it("list_sponsors clamps the limit to 100 records", () => {
    const total: i32 = 101;
    for (let i = 0; i < total; i++) {
      const addr = syntheticAddress(i);
      Testing.authorize([addr]);
      contract.set_sponsor(sponsorArgs(addr, ENDPOINT, "", [], MAX_BYTES, true, <u32>i));
      clearEvents();
    }
    MockVM.commitTransaction();

    const page1 = list(null, 1000);
    expect(page1.length).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(Arrays.equal(page1[i].sponsor!, syntheticAddress(i))).toBe(true, "page1[" + i.toString() + "]");
      expect(page1[i].policy_version).toBe(<u32>i);
    }
    expect(list(null, 0).length).toBe(100);
    expect(list(null, 100).length).toBe(100);

    const page2 = list(page1[99].sponsor, 1000);
    expect(page2.length).toBe(1);
    expect(Arrays.equal(page2[0].sponsor!, syntheticAddress(100))).toBe(true);
    expect(list(page2[0].sponsor, 1000).length).toBe(0);
  });

  it("list_sponsors reflects deactivation and updates", () => {
    registerSponsor(SPONSOR_A);
    registerSponsor(SPONSOR_B);
    deactivate(SPONSOR_B);
    Testing.authorize([SPONSOR_A]);
    contract.set_sponsor(sponsorArgs(SPONSOR_A, ENDPOINT, POLICY_URI, [], MAX_BYTES, true, 7));
    const values = list(null, 10);
    expectListed(values, [SPONSOR_B, SPONSOR_A]);
    expect(values[0].active).toBe(false);
    expect(values[1].policy_version).toBe(7);
  });
});
