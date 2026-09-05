// Open Social Protocol - sponsorship contract (protocol v1).
//
// On-chain discovery of Mana sponsors (payers) and their published policies,
// plus prospective, revocable per-user grants. See docs/protocol-spec.md
// section 10 and ADR 0002. Sponsors are replaceable services: any account may
// register, users may pick any sponsor or self-pay, and a sponsor's refusal
// never affects protocol permission. Nothing in this contract is consulted by
// the other protocol contracts; it only publishes policy for clients and
// sponsors to discover.
//
// State is compact: one sponsor_record per sponsor account and one user_grant
// per (sponsor, user) pair. Everything else is emitted as osp.sponsorship.*
// events.
//
// Authority: sponsors are plain Koinos accounts (no identity dependency). Every
// mutating method requires the sponsor account's contract_call authority on the
// current transaction (System.requireAuthority, enhanced-security semantics).
import { System, Storage, Protobuf, authority, Arrays } from "@koinos/sdk-as";
import { sponsorship } from "./proto/sponsorship";
import { Util } from "./common/util";

// State spaces (one per map).
const SPONSORS_SPACE: u32 = 1;
const GRANTS_SPACE: u32 = 2;

// Limits.
const MAX_ENDPOINT_LENGTH: i32 = 256;
const MAX_POLICY_URI_LENGTH: i32 = 256;
const MAX_ALLOWED_CALLS: i32 = 32;
const MAX_ENTRY_POINTS_PER_CALL: i32 = 64;
const MAX_BYTES_PER_OP: u32 = 65536;
const MAX_LIST_LIMIT: u32 = 100;

// Accepted endpoint schemes: https anywhere, plain http only for localhost.
const HTTPS_PREFIX: string = "https://";
const LOCALHOST: string = "http://localhost";

export class Sponsorship {
  contractId: Uint8Array;
  sponsors: Storage.Map<Uint8Array, sponsorship.sponsor_record>;
  grants: Storage.Map<Uint8Array, sponsorship.user_grant>;

  constructor() {
    const contractId = System.getContractId();
    this.contractId = contractId;
    this.sponsors = new Storage.Map<Uint8Array, sponsorship.sponsor_record>(
      contractId,
      SPONSORS_SPACE,
      sponsorship.sponsor_record.decode,
      sponsorship.sponsor_record.encode,
      null
    );
    this.grants = new Storage.Map<Uint8Array, sponsorship.user_grant>(
      contractId,
      GRANTS_SPACE,
      sponsorship.user_grant.decode,
      sponsorship.user_grant.encode,
      null
    );
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /** Grant key: sponsor || user (50 bytes). */
  grantKey(sponsor: Uint8Array, user: Uint8Array): Uint8Array {
    return Util.concat([sponsor, user]);
  }

  /** Require the sponsor account's contract_call authority on this transaction. */
  requireSponsorAuthority(sponsor: Uint8Array): void {
    System.requireAuthority(authority.authorization_type.contract_call, sponsor);
  }

  /**
   * Validate the sponsor API endpoint: at most 256 characters and, when
   * non-empty, an https URL or a plain-http localhost URL (local testing only:
   * exactly "http://localhost", or "http://localhost:" / "http://localhost/"
   * followed by anything). Returns the normalized (never null) string.
   */
  validateEndpoint(v: string | null): string {
    const endpoint = Util.requireString(v, MAX_ENDPOINT_LENGTH, "endpoint");
    if (endpoint.length == 0) return endpoint;
    let ok = endpoint.startsWith(HTTPS_PREFIX);
    if (!ok && endpoint.startsWith(LOCALHOST)) {
      ok =
        endpoint.length == LOCALHOST.length ||
        endpoint.charAt(LOCALHOST.length) == ":" ||
        endpoint.charAt(LOCALHOST.length) == "/";
    }
    System.require(ok, "endpoint must use https");
    return endpoint;
  }

  /** Validate the allowed-call list: <= 32 entries, 25-byte contract ids, <= 64 entry points each. */
  validateAllowed(allowed: Array<sponsorship.allowed_call>): void {
    System.require(allowed.length <= MAX_ALLOWED_CALLS, "too many allowed calls");
    for (let i = 0; i < allowed.length; i++) {
      Util.requireAddress(allowed[i].contract_id, "allowed contract_id");
      System.require(
        allowed[i].entry_points.length <= MAX_ENTRY_POINTS_PER_CALL,
        "too many entry points"
      );
    }
  }

  /** Load a sponsor record or revert. */
  requireSponsorRecord(sponsor: Uint8Array): sponsorship.sponsor_record {
    const rec = this.sponsors.get(sponsor);
    System.require(rec != null, "sponsor not registered");
    return rec!;
  }

  // ---------------------------------------------------------------------
  // Sponsors
  // ---------------------------------------------------------------------

  set_sponsor(
    args: sponsorship.set_sponsor_arguments
  ): sponsorship.set_sponsor_result {
    const sponsor = Util.requireAddress(args.sponsor, "sponsor");
    this.requireSponsorAuthority(sponsor);

    const endpoint = this.validateEndpoint(args.endpoint);
    const policyUri = Util.requireString(args.policy_uri, MAX_POLICY_URI_LENGTH, "policy_uri");
    this.validateAllowed(args.allowed);
    System.require(args.max_bytes_per_op <= MAX_BYTES_PER_OP, "max_bytes_per_op too large");

    const now = Util.now();
    const existing = this.sponsors.get(sponsor);
    const registeredAt: u64 = existing != null ? existing.registered_at : now;

    const rec = new sponsorship.sponsor_record(
      sponsor,
      endpoint,
      policyUri,
      args.policy_version,
      args.allowed,
      args.max_rc_per_op,
      args.max_ops_per_user_per_day,
      args.max_bytes_per_op,
      args.active,
      registeredAt,
      now
    );
    this.sponsors.put(sponsor, rec);

    const ev = new sponsorship.sponsor_set_event(sponsor, endpoint, args.policy_version, args.active, now);
    System.event(
      "osp.sponsorship.sponsor_set",
      Protobuf.encode(ev, sponsorship.sponsor_set_event.encode),
      [sponsor]
    );
    return new sponsorship.set_sponsor_result();
  }

  deactivate_sponsor(
    args: sponsorship.deactivate_sponsor_arguments
  ): sponsorship.deactivate_sponsor_result {
    const sponsor = Util.requireAddress(args.sponsor, "sponsor");
    this.requireSponsorAuthority(sponsor);

    const rec = this.requireSponsorRecord(sponsor);
    const now = Util.now();
    rec.active = false;
    rec.updated_at = now;
    this.sponsors.put(sponsor, rec);

    const ev = new sponsorship.sponsor_deactivated_event(sponsor, now);
    System.event(
      "osp.sponsorship.sponsor_deactivated",
      Protobuf.encode(ev, sponsorship.sponsor_deactivated_event.encode),
      [sponsor]
    );
    return new sponsorship.deactivate_sponsor_result();
  }

  // ---------------------------------------------------------------------
  // User grants
  // ---------------------------------------------------------------------

  set_user_grant(
    args: sponsorship.set_user_grant_arguments
  ): sponsorship.set_user_grant_result {
    const sponsor = Util.requireAddress(args.sponsor, "sponsor");
    const user = Util.requireAddress(args.user, "user");
    System.require(!Arrays.equal(sponsor, user), "user must differ from sponsor");
    this.requireSponsorAuthority(sponsor);

    System.require(args.daily_ops >= 1, "daily_ops must be at least 1");
    const now = Util.now();
    System.require(
      args.expires_at == 0 || args.expires_at > now,
      "expires_at must be 0 or in the future"
    );

    const rec = this.requireSponsorRecord(sponsor);
    System.require(rec.active, "sponsor inactive");

    const grant = new sponsorship.user_grant(sponsor, user, args.daily_ops, args.expires_at, false, now);
    this.grants.put(this.grantKey(sponsor, user), grant);

    const ev = new sponsorship.user_grant_set_event(sponsor, user, args.daily_ops, args.expires_at, now);
    System.event(
      "osp.sponsorship.user_grant_set",
      Protobuf.encode(ev, sponsorship.user_grant_set_event.encode),
      [sponsor, user]
    );
    return new sponsorship.set_user_grant_result();
  }

  revoke_user_grant(
    args: sponsorship.revoke_user_grant_arguments
  ): sponsorship.revoke_user_grant_result {
    const sponsor = Util.requireAddress(args.sponsor, "sponsor");
    const user = Util.requireAddress(args.user, "user");
    this.requireSponsorAuthority(sponsor);

    const key = this.grantKey(sponsor, user);
    const grant = this.grants.get(key);
    System.require(grant != null, "grant not found");

    const now = Util.now();
    grant!.revoked = true;
    grant!.updated_at = now;
    this.grants.put(key, grant!);

    const ev = new sponsorship.user_grant_revoked_event(sponsor, user, now);
    System.event(
      "osp.sponsorship.user_grant_revoked",
      Protobuf.encode(ev, sponsorship.user_grant_revoked_event.encode),
      [sponsor, user]
    );
    return new sponsorship.revoke_user_grant_result();
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  get_sponsor(
    args: sponsorship.get_sponsor_arguments
  ): sponsorship.get_sponsor_result {
    const res = new sponsorship.get_sponsor_result();
    if (Util.isEmpty(args.sponsor)) return res;
    res.value = this.sponsors.get(args.sponsor!);
    return res;
  }

  list_sponsors(
    args: sponsorship.list_sponsors_arguments
  ): sponsorship.list_sponsors_result {
    // limit 0 (unset) means the maximum page; anything else is clamped to 1..100.
    let limit: u32 = args.limit;
    if (limit == 0 || limit > MAX_LIST_LIMIT) limit = MAX_LIST_LIMIT;
    // `start` is an exclusive cursor: records with key > start, in address order.
    const start: Uint8Array = Util.isEmpty(args.start) ? new Uint8Array(0) : args.start!;

    const objs = this.sponsors.getMany(start, <i32>limit, Storage.Direction.Ascending);
    const values: Array<sponsorship.sponsor_record> = [];
    for (let i = 0; i < objs.length; i++) values.push(objs[i].value);
    return new sponsorship.list_sponsors_result(values);
  }

  get_user_grant(
    args: sponsorship.get_user_grant_arguments
  ): sponsorship.get_user_grant_result {
    const res = new sponsorship.get_user_grant_result();
    if (Util.isEmpty(args.sponsor) || Util.isEmpty(args.user)) return res;
    res.value = this.grants.get(this.grantKey(args.sponsor!, args.user!));
    return res;
  }
}
