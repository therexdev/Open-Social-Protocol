# OSP sponsorship contract

Koinos smart contract for the Open Social Protocol sponsorship registry
(protocol v1): on-chain discovery of Mana sponsors (payers), their published
policies, and prospective, revocable per-user grants. Normative semantics:
`docs/protocol-spec.md` section 10 (Sponsorship); design rationale: ADR 0002.
Wire format: `packages/proto/osp/sponsorship.proto`.

A sponsor is a replaceable service. Any account may register, users may pick any
sponsor or self-pay, and a sponsor's refusal never affects protocol permission:
nothing in this contract is consulted by the other protocol contracts. The
record published here is what clients and sponsors discover; the live policy is
served from the sponsor's endpoint (`GET /.well-known/osp-sponsor.json`,
`docs/sponsor-api.md`). Quotas (`max_ops_per_user_per_day`, `daily_ops`) are
enforced off chain by the sponsor; the contract only publishes them.

## Layout

| Path | Purpose |
| --- | --- |
| `assembly/Sponsorship.ts` | Contract implementation (class `Sponsorship`) |
| `assembly/index.ts`, `assembly/Sponsorship.boilerplate.ts` | Generated entry-point dispatch (do not edit) |
| `assembly/proto/sponsorship.ts` | Generated message classes (do not edit) |
| `assembly/common/{actor,util,testing}.ts` | Shared helpers copied from `packages/contracts/common` by the build (do not edit) |
| `assembly/__tests__/Sponsorship.spec.ts` | Unit tests (as-pect 8 + Koinos mock VM) |
| `abi/sponsorship.abi` | Generated Koinos ABI |

## Authority model

The contract has no identity dependency. Sponsors are plain Koinos accounts:
every mutating method requires the `contract_call` authority of the `sponsor`
argument on the current transaction
(`System.requireAuthority(contract_call, sponsor)`, enhanced-security
semantics). A call signed by any other account reverts with
`account '<sponsor>' authorization failed`. Users never sign anything here;
grants are unilateral, prospective statements by the sponsor.

## Methods

Entry points are the first 4 bytes of `sha256(method name)`; see
`abi/sponsorship.abi`.

### Sponsors

| Method | Rules | Event |
| --- | --- | --- |
| `set_sponsor(sponsor, endpoint, policy_uri, policy_version, allowed, max_rc_per_op, max_ops_per_user_per_day, max_bytes_per_op, active)` | Upsert. Sponsor authority. `endpoint` at most 256 characters and, when non-empty, `https://...` or a plain-http localhost URL for local testing (`http://localhost`, `http://localhost:<port>...`, `http://localhost/...`); anything else reverts with `endpoint must use https`. `policy_uri` at most 256 characters. `allowed` at most 32 entries, each with a 25-byte `contract_id` and at most 64 `entry_points` (empty = every entry point of that contract). `max_bytes_per_op` at most 65536. `registered_at` is kept from the existing record (or set to now on first registration); `updated_at` is now. `active` is stored as given, so a sponsor can register inactive, or re-activate after `deactivate_sponsor`. | `sponsor_set{sponsor, endpoint, policy_version, active, timestamp}` impacted `[sponsor]` |
| `deactivate_sponsor(sponsor)` | Sponsor authority; record must exist (`sponsor not registered`). Sets `active = false`, `updated_at = now`; every other field is preserved. Idempotent: deactivating an inactive sponsor succeeds and emits the event again. | `sponsor_deactivated{sponsor, timestamp}` impacted `[sponsor]` |

### User grants

| Method | Rules | Event |
| --- | --- | --- |
| `set_user_grant(sponsor, user, daily_ops, expires_at)` | Upsert. Sponsor authority; `user != sponsor` (`user must differ from sponsor`); `daily_ops >= 1`; `expires_at` is `0` (no expiry) or strictly greater than the head block time (`expires_at must be 0 or in the future`); the sponsor record must exist (`sponsor not registered`) and be active (`sponsor inactive`). Stores `{sponsor, user, daily_ops, expires_at, revoked: false, updated_at: now}`, replacing any previous grant for the pair, which also clears an earlier revocation. | `user_grant_set{sponsor, user, daily_ops, expires_at, timestamp}` impacted `[sponsor, user]` |
| `revoke_user_grant(sponsor, user)` | Sponsor authority; the grant must exist (`grant not found`). Sets `revoked = true`, `updated_at = now`; `daily_ops` and `expires_at` are preserved. Works whether or not the sponsor is still active. Idempotent: revoking a revoked grant succeeds and emits the event again. | `user_grant_revoked{sponsor, user, timestamp}` impacted `[sponsor, user]` |

Grants are prospective: revoking or letting a grant expire never affects
transactions already sponsored. Expiry is not enforced by the contract; an
expired grant stays readable with its original `expires_at` and sponsors and
clients compare it with the current time.

### Reads (read-only)

| Method | Result |
| --- | --- |
| `get_sponsor(sponsor)` | The `sponsor_record`; `value` null when unknown or when the argument is empty. |
| `list_sponsors(start, limit)` | Up to `limit` `sponsor_record`s in ascending address (byte) order, starting **after** `start` (exclusive cursor; empty `start` begins at the lowest address). `limit = 0` returns the maximum page (100); any other value is clamped to `1..100`. Inactive sponsors are listed too. To page, pass the `sponsor` of the last returned record as the next `start`; an empty result means the end. |
| `get_user_grant(sponsor, user)` | The `user_grant`; null when the pair has no grant or an argument is empty. |

## State spaces

| Space id | Map | Key | Value |
| --- | --- | --- | --- |
| 1 | sponsors | `sponsor` (25 bytes) | `sponsor_record{sponsor, endpoint, policy_uri, policy_version, allowed[], max_rc_per_op, max_ops_per_user_per_day, max_bytes_per_op, active, registered_at, updated_at}` |
| 2 | grants | `sponsor ‖ user` (50 bytes) | `user_grant{sponsor, user, daily_ops, expires_at, revoked, updated_at}` |

Records are never deleted: deactivation and revocation are flags, so the
history of a sponsor's registration (`registered_at`) and of a grant survives
across re-activations (ADR 0002).

## Limits and validation

* All address arguments must be exactly 25 bytes (`<name> must be a 25-byte address`,
  `<name> is required`); `allowed[i].contract_id` reports as `allowed contract_id`.
* `endpoint`: at most 256 characters (`endpoint too long`), scheme as above.
* `policy_uri`: at most 256 characters (`policy_uri too long`).
* `allowed`: at most 32 entries (`too many allowed calls`), each with at most 64
  entry points (`too many entry points`).
* `max_bytes_per_op`: at most 65536 (`max_bytes_per_op too large`).
  `max_rc_per_op` and `max_ops_per_user_per_day` are stored as given.
* `daily_ops >= 1`; `expires_at == 0 || expires_at > now`.
* Timestamps (`registered_at`, `updated_at`, `expires_at`, event `timestamp`)
  are head block time in milliseconds.

### System-call buffer

A maximum-size `sponsor_record` (32 allowed calls with 64 entry points each,
two 256-character URIs) encodes to roughly 13 KiB. The `@koinos/sdk-as` system
call buffer, through which call arguments and every database read come back,
defaults to 1 KiB, and the chain fails a call whose result does not fit. The
generated `index.ts` reads the arguments before constructing the contract, so
`Sponsorship.ts` raises the buffer to 32 KiB with `System.setSystemBufferSize`
at module scope: imported modules run their top-level statements before
`index.ts` calls `main()` (verified in the compiled `start` function). Importing
the contract into a spec has the same effect, which is what lets the tests read
back maximum-size records and events.

## Events

All events are named `osp.sponsorship.<event>` and carry the canonical encoding
of the matching `*_event` message (spec 12): `sponsor_set`,
`sponsor_deactivated`, `user_grant_set`, `user_grant_revoked`. `impacted` lists
the sponsor first and, for grant events, the user second. Indexers can rebuild
the sponsor directory and every grant from these events alone; `sponsor_set`
carries only the discovery fields (`endpoint`, `policy_version`, `active`), so
an indexer that needs the full policy reads `get_sponsor` or follows
`policy_uri`.

## Build and test

From the repository root:

```sh
node packages/contracts/scripts/build.mjs debug sponsorship    # regenerate bindings + debug WASM
node packages/contracts/scripts/build.mjs release sponsorship  # release WASM (packages/contracts/build/release/sponsorship.wasm + .abi)
node packages/contracts/scripts/test.mjs sponsorship           # as-pect unit tests
```

The tests run fully offline and make no cross-contract calls.
`Testing.authorize([...])` marks which addresses signed the transaction, so an
"unauthorized" test signs with an account other than the sponsor. A revert rolls
the mock database back to the last `MockVM.commitTransaction()`, so fixtures are
committed explicitly. The mock database orders keys by comparing the encoded
database key as a JavaScript string; the fixture addresses and the synthetic
addresses used by the 101-sponsor pagination test are chosen so that this order
equals the chain's byte order. `MockVM.clearEvents()` is called after fixtures so
event assertions see only the action under test.
