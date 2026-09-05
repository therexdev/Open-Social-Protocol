# OSP relationships contract

Koinos smart contract for the Open Social Protocol relationship registry
(protocol v1): mutual friendships, unilateral follows, blocks and the per-author
friends-audience epoch. Normative semantics: `docs/protocol-spec.md` sections 4
(relationships), 3.1-3.2 (authority classes, actor resolution) and 5.3
(revocation); design rationale: ADR 0002 and ADR 0003. Wire format:
`packages/proto/osp/relationships.proto`.

Relationship state is public metadata by design. Removing or blocking a friend
advances the actor's audience epoch so that future friends-only content is
encrypted under a key the removed party never receives; nothing already
delivered can be recalled.

## Layout

| Path | Purpose |
| --- | --- |
| `assembly/Relationships.ts` | Contract implementation (class `Relationships`) |
| `assembly/index.ts`, `assembly/Relationships.boilerplate.ts` | Generated entry-point dispatch (do not edit) |
| `assembly/proto/relationships.ts`, `assembly/proto/identity.ts` | Generated message classes (do not edit) |
| `assembly/common/{actor,util,testing}.ts` | Shared helpers copied from `packages/contracts/common` by the build (do not edit) |
| `assembly/__tests__/Relationships.spec.ts` | Unit tests (as-pect 8 + Koinos mock VM) |
| `abi/relationships.abi` | Generated Koinos ABI |

## Authority model

Every mutating method resolves its signer through the configured identity
contract (`identity.resolve_actor(account, device, capability)`) and then
requires that signer's `contract_call` authority on the current transaction
(`Actor.requireAuthorized`, spec 3.2):

* Methods with a `device` argument (`request_friend`, `accept_friend`,
  `remove_friend`, `follow`, `unfollow`, `rotate_audience`) accept either the
  identity owner (empty device) or an authorized, unexpired device key holding
  the `RELATIONSHIPS` capability (bit `8`).
* `block` and `unblock` carry no `device` argument and resolve with
  `device = empty, capability = 0`: only the identity owner can block (spec 3.1).
* `request_friend` and `follow` additionally require the counterparty to be a
  registered identity (`Actor.exists`, a second `resolve_actor` call).
* `set_identity_contract` requires the `contract_call` authority of the
  contract's own account.

## Methods

Entry points are the first 4 bytes of `sha256(method name)`; see
`abi/relationships.abi`.

### Admin

| Method | Rules |
| --- | --- |
| `set_identity_contract(address)` | Contract account only; `address` must be a 25-byte address. Stored in the config space; can be replaced. |

### Friendships

| Method | Rules | Event |
| --- | --- | --- |
| `request_friend(requester, recipient, device)` | `requester != recipient`; requester authorized; recipient registered; neither side has blocked the other; no `pending` (`already pending`) or `active` (`already friends`) edge. An `inactive` edge may be re-requested. Creates `{a: min, b: max, status: pending, requester, nonce: previous + 1 (or 1), updated_at}`. | `friend_requested{requester, recipient, nonce, timestamp}` impacted `[requester, recipient]` |
| `accept_friend(approver, requester, device, key_package_ref)` | `approver != requester`; approver authorized; `key_package_ref` empty or 32 bytes; edge must be `pending` (`no pending request`) with `record.requester == requester` (`requester mismatch`), so the approver is necessarily the other party. Sets `active`, `nonce += 1`. | `friend_accepted{approver, requester, nonce, key_package_ref, timestamp}` impacted `[approver, requester]` |
| `remove_friend(actor, peer, device)` | `actor != peer`; actor authorized; edge must be `active` (`not friends`). Sets `inactive`, `nonce += 1`, advances the **actor's** epoch. | `friend_removed{actor, peer, nonce, new_epoch, timestamp}` impacted `[actor, peer]`, then `audience_rotated{account, new_epoch, reason: "friend_removed", timestamp}` impacted `[actor]` |

### Blocks (owner only)

| Method | Rules | Event |
| --- | --- | --- |
| `block(actor, target)` | `actor != target`; owner authority; not already blocked (`already blocked`). Writes `blocks[actor‖target] = {blocked: true}`; any `pending`/`active` edge becomes `inactive` with `nonce += 1` (no `friend_removed` event); deletes the follow records in both directions; advances the actor's epoch. | `blocked{actor, target, new_epoch, timestamp}` impacted `[actor, target]`, then `audience_rotated{reason: "blocked"}` impacted `[actor]` |
| `unblock(actor, target)` | `actor != target`; owner authority; block must exist (`not blocked`). Deletes the block record. Does not touch the epoch or the (inactive) edge; a new request is required to become friends again. | `unblocked{actor, target, timestamp}` impacted `[actor, target]` |

Blocks are directional: `is_blocked(a, b)` is independent of `is_blocked(b, a)`,
but a block in either direction prevents `request_friend` and `follow` between
the pair (`recipient is blocked` / `blocked by recipient`, `target is blocked` /
`blocked by target`).

### Follows (unilateral)

| Method | Rules | Event |
| --- | --- | --- |
| `follow(follower, target, device)` | `follower != target`; follower authorized; target registered; neither side has blocked the other; not already active (`already following`). Writes `follows[follower‖target] = {active: true}`. | `followed{follower, target, timestamp}` impacted `[follower, target]` |
| `unfollow(follower, target, device)` | `follower != target`; follower authorized; follow must be active (`not following`). Deletes the record. | `unfollowed{follower, target, timestamp}` impacted `[follower, target]` |

### Audience epoch

| Method | Rules | Event |
| --- | --- | --- |
| `rotate_audience(actor, device)` | Actor authorized with the `RELATIONSHIPS` capability. `epoch += 1`. | `audience_rotated{account, new_epoch, reason: "manual", timestamp}` impacted `[actor]` |

The epoch of an account starts at `0` and only ever increases (`remove_friend`,
`block`, `rotate_audience`). Publications with `audience = friends` carry the
author's current epoch (spec 2.3, 5.2).

### Reads (read-only, never call the identity contract)

| Method | Result |
| --- | --- |
| `get_relationship(a, b)` | The `relationship_record` for the pair in either argument order; `value` null when no edge exists or an argument is empty. |
| `get_audience(account)` | The `audience_state`; `{epoch: 0, updated_at: 0}` when unset (never null). |
| `is_blocked(actor, target)` | `true` only when `actor` currently blocks `target`. |
| `get_follow(follower, target)` | The `follow_record`; null when missing. |
| `get_identity_contract()` | The configured identity contract address; null when unset. |

## State spaces

| Space id | Map | Key | Value |
| --- | --- | --- | --- |
| 1 | relationships | `min(a, b) ‖ max(a, b)` (lexicographic byte order, 50 bytes) | `relationship_record{a, b, status, requester, nonce, updated_at}` |
| 2 | blocks | `actor ‖ target` | `block_record{blocked, updated_at}` |
| 3 | follows | `follower ‖ target` | `follow_record{active, updated_at}` |
| 4 | audiences | `account` | `audience_state{epoch, updated_at}` |
| 5 | config (single object) | - | `get_identity_contract_result{value}` (identity contract address) |

Records are compact and hold only what validation needs (ADR 0002). Follow and
block records are deleted rather than flagged when removed; relationship edges
are kept (`inactive`) so the per-pair `nonce` keeps increasing across
re-requests, which lets clients bind key packages to a specific relationship
instance.

## Limits and validation

* All address arguments must be exactly 25 bytes (`<name> must be a 25-byte address`,
  `<name> is required`).
* `key_package_ref`: empty or exactly 32 bytes.
* Self-referential operations are rejected (`cannot friend yourself`,
  `cannot block yourself`, `cannot follow yourself`, ...).
* Write methods revert with `identity contract not configured` until
  `set_identity_contract` has been called.
* Timestamps (`updated_at`, event `timestamp`) are the head block time in
  milliseconds.

## Events

All events are named `osp.relationships.<event>` and carry the canonical
encoding of the matching `*_event` message (spec 12): `friend_requested`,
`friend_accepted`, `friend_removed`, `blocked`, `unblocked`, `followed`,
`unfollowed`, `audience_rotated`. `impacted` always lists the acting account
first and the counterparty second; `audience_rotated` impacts only the account
whose epoch changed. `audience_rotated.reason` is one of `friend_removed`,
`blocked`, `manual`.

## Build and test

From the repository root:

```sh
node packages/contracts/scripts/build.mjs debug relationships    # regenerate bindings + debug WASM
node packages/contracts/scripts/build.mjs release relationships  # release WASM (packages/contracts/build/release/relationships.wasm + .abi)
node packages/contracts/scripts/test.mjs relationships           # as-pect unit tests
```

The tests run fully offline. The identity contract is stubbed with
`Testing.mockResolveActor(...)` / `MockVM.setCallContractResults(...)`: every
`resolve_actor` call consumes one queued result, in call order (`request_friend`
and `follow` make two calls: actor resolution, then counterparty existence; every
other write makes one). `Testing.authorize([...])` marks which addresses signed
the transaction, so an "unauthorized signer" test resolves the actor to one
address and signs with another. The mock VM returns its event list through a
1 KiB buffer, so tests call `MockVM.clearEvents()` after building fixtures and
before asserting on the events of the action under test.
