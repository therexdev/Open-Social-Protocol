# OSP communities contract

Koinos smart contract for the Open Social Protocol community layer (protocol
v1): signed roles with scope and expiry, policy references, moderation labels
and time-locked ownership transfer. Normative semantics: `docs/protocol-spec.md`
section 9 (communities), 3.1-3.2 (authority classes, actor resolution) and 12
(events); design rationale: ADR 0002 and ADR 0003. Wire format:
`packages/proto/osp/communities.proto`.

Communities are an optional layer over the base identity / relationship /
publication facts. They never invalidate an underlying signed publication:
labels are moderation facts emitted as events, and roles are admission and
ranking facts that clients and indexers may honour. Community policies are
documents referenced by hash (and an optional URI).

## Layout

| Path | Purpose |
| --- | --- |
| `assembly/Communities.ts` | Contract implementation (class `Communities`) |
| `assembly/index.ts`, `assembly/Communities.boilerplate.ts` | Generated entry-point dispatch (do not edit) |
| `assembly/proto/communities.ts`, `assembly/proto/identity.ts` | Generated message classes (do not edit) |
| `assembly/common/{actor,util,testing}.ts` | Shared helpers copied from `packages/contracts/common` by the build (do not edit) |
| `assembly/__tests__/Communities.spec.ts` | Unit tests (as-pect 8 + Koinos mock VM) |
| `abi/communities.abi` | Generated Koinos ABI |

## Authority model

Every mutating method resolves its signer through the configured identity
contract (`identity.resolve_actor(account, device, capability)`) and then
requires that signer's `contract_call` authority on the current transaction
(`Actor.requireAuthorized`, spec 3.2):

* `set_role`, `set_policy` and `set_label` carry a `device` argument and accept
  either the identity owner (empty device) or an authorized, unexpired device key
  holding the `COMMUNITY` capability (bit `16`). Records and events always name
  the acting identity (`actor`), never the device key.
* `create_community` carries a `device` field for wire compatibility but
  **ignores it**: it always resolves `device = empty, capability = 0`, so only
  the identity owner can create a community.
* `propose_owner_transfer` and `cancel_owner_transfer` have no `device` field and
  resolve with `device = empty, capability = 0`: owner key only (spec 3.1).
* `execute_owner_transfer` is permissionless: anyone may submit it once the
  time-lock has elapsed. It never calls the identity contract.
* `set_identity_contract` requires the `contract_call` authority of the
  contract's own account.

### Roles and ranks

`guest(1) < member(2) < moderator(3) < admin(4) < owner(5)`; `banned(6)` and
`none(0)` rank `0` for every permission check.

The **effective role** of an account in a community is:

1. `owner` when the account equals `community_record.owner` (ownership is
   implicit; the owner never has a role record);
2. otherwise the stored `role_record.role` when a record exists and is not
   expired (`expires_at == 0` or `expires_at > head_block_time`);
3. otherwise `none`.

A role record expires at exactly `expires_at` (a call at `head_block_time ==
expires_at` sees `none`). The contract stores expired records untouched;
`get_role` returns them as stored and callers compute effective roles with the
rule above. `scope` is stored and emitted but not interpreted on chain: it is a
hint for clients and indexers (e.g. a topic or label namespace).

Permission matrix (`actor` = effective rank of the caller):

| Action | Required rank |
| --- | --- |
| `set_role` to `none/guest/member/moderator/banned` on a subject below admin | admin or owner |
| `set_role` to `admin`, or on a subject who is currently admin | owner only |
| `set_role` to `owner` | never (`use ownership transfer`) |
| `set_role` on the community owner | never (`cannot change owner role`) |
| `set_policy` | admin or owner |
| `set_label` | moderator, admin or owner |
| `propose_owner_transfer`, `cancel_owner_transfer` | owner (`community_record.owner`) |
| `execute_owner_transfer` | anyone, after `transfer_effective_at` |

## Methods

Entry points are the first 4 bytes of `sha256(method name)`; see
`abi/communities.abi`.

### Admin

| Method | Rules |
| --- | --- |
| `set_identity_contract(address)` | Contract account only; `address` must be a 25-byte address. Stored in the config space; can be replaced. |

### Community lifecycle

| Method | Rules | Event |
| --- | --- | --- |
| `create_community(creator, id, name, policy_hash, policy_uri, transfer_delay_ms, device)` | `creator` 25 bytes and authorized as identity owner (device ignored); `id` 1..32 bytes and unused (`community id already exists`); `name` 1..64 chars; `policy_hash` empty or 32 bytes; `policy_uri` <= 256 chars; `transfer_delay_ms` <= 30 days (`2 592 000 000`). Stores `{id, owner: creator, name, policy_hash, policy_uri, transfer_delay_ms, created_at: now, updated_at: now}`. | `community_created{id, owner, name, policy_hash, policy_uri, transfer_delay_ms, timestamp}` impacted `[creator]` |
| `set_policy(community_id, actor, policy_hash, policy_uri, device)` | Community exists; actor authorized (`COMMUNITY` capability) with effective rank >= admin (`insufficient role`); same `policy_hash` / `policy_uri` validation as creation. Empty values clear the policy. Sets `updated_at`. | `policy_set{community_id, actor, policy_hash, policy_uri, timestamp}` impacted `[actor]` |

### Roles

| Method | Rules | Event |
| --- | --- | --- |
| `set_role(community_id, actor, subject, role, scope, expires_at, device)` | Community exists; `role` in `0..6` (`invalid role`); `scope` <= 32 bytes; `expires_at == 0` or `> now` (`expires_at must be 0 or in the future`); actor authorized (`COMMUNITY` capability) with rank >= admin (`insufficient role`); `subject != community.owner` (`cannot change owner role`); `role != owner` (`use ownership transfer`); an admin (not owner) may only set roles ranking below admin (`admin may only set roles below admin`) and only on subjects whose effective rank is below admin (`admin cannot change an admin's role`, which also blocks self-demotion). `role == none` deletes the record; otherwise stores `{role, scope, expires_at, granted_by: actor, granted_at: now}` (re-granting overwrites every field). The community record is not touched. | `role_set{community_id, actor, subject, role, scope, expires_at, timestamp}` impacted `[actor, subject]` (also emitted for `none`) |

Because `banned` ranks `0`, an admin may ban or un-ban any non-admin, and the
owner may ban an admin; a banned account cannot label, set roles or policies
until its role is changed again. Roles are per community: an admin of one
community has no rank in another.

### Ownership transfer (time-locked)

| Method | Rules | Event |
| --- | --- | --- |
| `propose_owner_transfer(community_id, owner, new_owner)` | Community exists; `owner == community.owner` (`only the owner may propose a transfer`); owner authorized (owner key); `new_owner` 25 bytes and `!= owner` (`new_owner must differ from owner`). Sets `pending_owner = new_owner`, `transfer_effective_at = now + transfer_delay_ms`, `updated_at`. A new proposal replaces a pending one and restarts the delay. | `owner_transfer_proposed{community_id, owner, new_owner, effective_at}` impacted `[owner, new_owner]` |
| `cancel_owner_transfer(community_id, owner)` | Community exists; `owner == community.owner` (`only the owner may cancel a transfer`); owner authorized; a proposal must be pending (`no pending transfer`). Clears `pending_owner` and `transfer_effective_at`, sets `updated_at`. | `owner_transfer_cancelled{community_id, timestamp}` impacted `[owner, previous pending_owner]` |
| `execute_owner_transfer(community_id)` | Community exists; a proposal must be pending (`no pending transfer`); `now >= transfer_effective_at` (`transfer delay not elapsed`). No signature required. Sets `owner = pending_owner`, clears the pending fields, sets `updated_at`, and deletes any explicit role record of the new owner (ownership is implicit). The previous owner keeps no role: it is an outsider (`none`) until the new owner grants one. | `owner_transferred{community_id, previous_owner, new_owner, timestamp}` impacted `[previous_owner, new_owner]` |

With `transfer_delay_ms == 0` a proposal is executable in the same block. The
new owner is not required to sign or to be a registered identity; the proposing
owner is responsible for choosing a valid account.

### Moderation labels (events only)

| Method | Rules | Event |
| --- | --- | --- |
| `set_label(community_id, actor, post_id, label, reason, device)` | Community exists; `post_id` exactly 32 bytes (`post_id must be 32 bytes`); `label` 1..64 chars; `reason` <= 256 chars (may be empty); actor authorized (`COMMUNITY` capability) with rank >= moderator (`insufficient role`). Writes **no state**. | `label_set{community_id, actor, post_id, label, reason, timestamp}` impacted `[actor]` |

The label vocabulary is community policy (e.g. `hide`, `warn:nsfw`,
`appeal:granted`); the same post may be labelled any number of times and
indexers reduce the event stream. Labels never alter publication validity
(spec 9).

### Reads (read-only, never call the identity contract)

| Method | Result |
| --- | --- |
| `get_community(id)` | The `community_record`; `value` null when missing or `id` empty. |
| `get_role(community_id, subject)` | The stored `role_record` (including expired ones); null when missing or an argument is empty. Callers compute effective roles (see above). |
| `get_identity_contract()` | The configured identity contract address; null when unset. |

## State spaces

| Space id | Map | Key | Value |
| --- | --- | --- | --- |
| 1 | communities | `id` (1..32 bytes) | `community_record{id, owner, name, policy_hash, policy_uri, transfer_delay_ms, pending_owner, transfer_effective_at, created_at, updated_at}` |
| 2 | roles | `community_id ‖ subject` (subject is a fixed 25-byte address, so variable-length ids cannot collide) | `role_record{role, scope, expires_at, granted_by, granted_at}` |
| 3 | config (single object) | - | `get_identity_contract_result{value}` (identity contract address) |

Records are compact and hold only what validation needs (ADR 0002): labels,
role history and transfer history live only in events. Role records are deleted
when a role is set to `none` and when their subject becomes the owner.

## Limits and validation

* All address arguments must be exactly 25 bytes (`<name> must be a 25-byte address`,
  `<name> is required`).
* `id` / `community_id`: 1..32 bytes (`community id is required`, `community id too large`).
* `name`: 1..64 characters (`name is required`, `name too long`).
* `policy_hash`: empty or exactly 32 bytes (`policy_hash must be empty or 32 bytes`).
* `policy_uri`: <= 256 characters (`policy_uri too long`).
* `transfer_delay_ms`: <= 30 days (`transfer_delay_ms too large`).
* `scope`: <= 32 bytes (`scope too large`).
* `expires_at`: `0` or strictly greater than the head block time.
* `post_id`: exactly 32 bytes; `label`: 1..64 characters; `reason`: <= 256 characters.
* Unknown communities revert with `community not found`.
* Write methods revert with `identity contract not configured` until
  `set_identity_contract` has been called.
* Timestamps (`created_at`, `updated_at`, `granted_at`, `transfer_effective_at`,
  event `timestamp` / `effective_at`) are the head block time in milliseconds.

## Events

All events are named `osp.communities.<event>` and carry the canonical encoding
of the matching `*_event` message (spec 12): `community_created`, `role_set`,
`policy_set`, `owner_transfer_proposed`, `owner_transfer_cancelled`,
`owner_transferred`, `label_set`. `impacted` lists the acting account first and
the counterparty (subject, new owner, previous pending owner) second where one
exists. Every successful write emits exactly one event.

## Build and test

From the repository root:

```sh
node packages/contracts/scripts/build.mjs debug communities    # regenerate bindings + debug WASM
node packages/contracts/scripts/build.mjs release communities  # release WASM (packages/contracts/build/release/communities.wasm + .abi)
node packages/contracts/scripts/test.mjs communities           # as-pect unit tests
```

The tests run fully offline. The identity contract is stubbed with
`Testing.mockResolveActor(...)`: every `resolve_actor` call consumes one queued
result, in call order (every write makes exactly one call, except
`execute_owner_transfer`, which makes none). `Testing.authorize([...])` marks
which addresses signed the transaction, so an "unauthorized signer" test resolves
the actor to one address and signs with another. `Testing.setTime(...)` moves
the head block time to exercise role expiry and the transfer time-lock. The mock
VM returns its event list through a 1 KiB buffer, so tests call
`MockVM.clearEvents()` after building fixtures and before asserting on the
events of the action under test; cross-contract call arguments are not cleared,
so assertions on the resolved actor always inspect the most recent call.
