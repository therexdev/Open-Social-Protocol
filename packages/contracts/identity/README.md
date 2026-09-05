# OSP identity contract

Canonical identity registry for the Open Social Protocol (protocol v1). It publishes
each account's X25519 encryption key and profile reference, tracks expiring
device/session authorities with capability bits, and implements M-of-N guardian
recovery under a time delay. Normative semantics: `docs/protocol-spec.md` sections 3,
3.1, 3.2 and 3.3; design rationale: ADR 0002 and ADR 0003. Wire format:
`packages/proto/osp/identity.proto`.

The identity address (`account`) is stable for life. Its `owner` starts equal to
`account` and only changes through `execute_recovery`.

## State spaces

| Space id | Map | Key | Value |
| --- | --- | --- | --- |
| 1 | identities | `account` (25 bytes) | `identity_record` |
| 2 | devices | `account \|\| device` (50 bytes) | `device_record` |
| 3 | recovery | `account` (25 bytes) | `recovery_state` (policy, pending policy, pending recovery) |

State holds only what validation needs; every change is also emitted as an event so
indexers rebuild projections from history alone (ADR 0002).

## Authority classes

| Class | Who signs | May call |
| --- | --- | --- |
| Owner | `identity_record.owner` (`contract_call` authority) | `update_profile` (device empty), `rotate_encryption_key`, `authorize_device`, `revoke_device`, `set_recovery_policy`, `cancel_recovery_policy`, `cancel_recovery` |
| Device | an authorized, unexpired, unrevoked device of the current `device_epoch` | `update_profile` with capability `profile` (32); other contracts resolve devices through `resolve_actor` |
| Guardian | an address in `recovery_policy.guardians` | `propose_recovery` |
| Anyone | no signature required | `apply_recovery_policy`, `execute_recovery`, all read methods |

`register` requires the `contract_call` authority of `account` itself.

Capability bits: `1 publish`, `2 react`, `4 comment`, `8 relationships`,
`16 community`, `32 profile`. Devices can never rotate keys, authorize devices,
change recovery or cancel a recovery.

## Methods

### Write methods

| Method | Authority | Rules | Event |
| --- | --- | --- | --- |
| `register(account, encryption_key, key_version, profile_hash, profile_uri)` | `account` | identity must not exist; key exactly 32 bytes; `key_version >= 1`; `profile_hash` empty or 32 bytes; `profile_uri <= 512` chars. Sets `owner = account`, `protocol_version = 1`, `device_epoch = 0`. | `registered` |
| `update_profile(account, profile_hash, profile_uri, device)` | resolved signer (owner, or device with `profile`) | same field rules as `register`; `device` resolved locally with the rules of `resolve_actor` | `profile_updated` |
| `rotate_encryption_key(account, encryption_key, key_version)` | owner | key exactly 32 bytes; `key_version` strictly greater than the current one (gaps allowed) | `key_rotated` (carries `previous_version`) |
| `authorize_device(account, device, capabilities, expires_at, label)` | owner | `device` is a 25-byte address different from `account`; `capabilities` non-zero and `<= 63`; `now < expires_at <= now + 366 days`; `label <= 64` chars. Stores the current `device_epoch`; re-authorizing an existing device overwrites it (this also revives a revoked or epoch-expired device). | `device_authorized` |
| `revoke_device(account, device)` | owner | device record must exist. Idempotent: revoking an already revoked device succeeds and emits the event again, so a retried transaction never reverts. | `device_revoked` |
| `set_recovery_policy(account, policy)` | owner | 1..16 distinct 25-byte guardians, none equal to `account`; `1 <= threshold <= guardians.length`; `delay_ms <= 365 days`. The first policy applies immediately. Later calls store a `pending_policy` that becomes effective after the *current* policy's `delay_ms` (a newer proposal replaces the pending one). | `recovery_policy_set` or `recovery_policy_proposed` |
| `apply_recovery_policy(account)` | anyone | a pending policy must exist and `now >= effective_at`; applies it and clears the pending entry. A policy change also voids any in-flight recovery (approvals were collected under the old guardian set, so a removed guardian's approval can never count toward the new threshold; guardians of the new policy propose again). | `recovery_policy_set`, preceded by `recovery_cancelled` when a pending recovery was voided |
| `cancel_recovery_policy(account)` | owner | a pending policy must exist | `recovery_policy_cancelled` |
| `propose_recovery(account, guardian, new_owner)` | `guardian` | guardian must be in the policy; `new_owner` is a 25-byte address different from the current owner. No pending recovery (or one for a different `new_owner`) starts a new approval set with this guardian; otherwise the guardian is added (a repeat approval reverts `already approved`). When approvals reach `threshold`, `effective_at = now + delay_ms` is fixed; further approvals do not move it. | `recovery_proposed` (approval count, threshold, `effective_at`) |
| `cancel_recovery(account)` | owner (the current key: recent-key proof) | a pending recovery must exist | `recovery_cancelled` |
| `execute_recovery(account)` | anyone | pending recovery with `effective_at != 0` and `now >= effective_at`. Sets `owner = new_owner`, increments `device_epoch` (voiding every device), updates `updated_at`, clears the pending recovery and voids any pending policy change queued by the previous owner (a leaked key must not leave a booby-trapped policy that anyone could apply after the recovery). The active recovery policy and the encryption key are untouched. | `recovered` (`previous_owner`, `new_owner`, `device_epoch`), preceded by `recovery_policy_cancelled` when a pending policy was voided |

### Read methods

| Method | Returns |
| --- | --- |
| `get_identity(account)` | `identity_record` or null |
| `get_device(account, device)` | `device_record` or null (revoked and epoch-expired devices are still returned) |
| `get_recovery(account)` | `recovery_state` or null |
| `resolve_actor(account, device, capability)` | `{ok, signer, reason}`, never reverts |

`resolve_actor` (spec 3.2), in order:

1. identity missing: `ok=false, reason="unregistered"`;
2. `device` empty or equal to `account`: `ok=true, signer=owner`;
3. otherwise the device record must exist (`unknown device`), not be revoked
   (`device revoked`), carry the current `device_epoch` (`device epoch expired`),
   have `expires_at > head_block_time` (`device expired`) and, when
   `capability != 0`, hold the bit (`capability not granted`); then
   `ok=true, signer=device`.

The identity contract only resolves; the calling contract requires the
`contract_call` authority of `signer` (see `common/actor.ts`).

## Revert messages

Authority failures revert with the SDK message
`account '<base58>' authorization failed`. Other messages:

`identity not registered`, `identity already registered`, `account must be a 25-byte
address`, `encryption_key is required`, `encryption_key must be 32 bytes`,
`key_version must be >= 1`, `key_version must increase`, `profile_hash must be empty
or 32 bytes`, `profile_uri too long`, `device must be a 25-byte address`, `device must
differ from account`, `capabilities must not be empty`, `unknown capability bits`,
`expires_at must be in the future`, `expires_at too far in the future`, `label too
long`, `unknown device`, `policy is required`, `at least one
guardian is required`, `too many guardians`, `guardian must be a 25-byte address`,
`guardian must differ from account`, `guardians must be distinct`, `threshold must be
>= 1`, `threshold exceeds guardian count`, `delay_ms too large`, `no pending recovery
policy`, `recovery policy delay not elapsed`, `no recovery policy`, `not a guardian`,
`new_owner is required`, `new_owner must be a 25-byte address`, `new_owner must differ
from current owner`, `already approved`, `no pending recovery`, `recovery threshold
not reached`, `recovery delay not elapsed`.

`update_profile` reverts with the `resolve_actor` reason (`unregistered`,
`unknown device`, ...) when the actor does not resolve.

## Limits (pilot)

| Limit | Value |
| --- | --- |
| Encryption key | exactly 32 bytes (X25519 public key) |
| Profile hash | empty or 32 bytes (sha256) |
| Profile URI | 512 characters |
| Device label | 64 characters |
| Device capabilities | bitmask 1..63 |
| Device lifetime | at most 366 days from the authorizing block |
| Guardians | 1..16 distinct addresses |
| Recovery / policy delay | at most 365 days |

All times are head-block times in milliseconds (`uint64`).

## Events

All events are named `osp.identity.<event>` with canonical protobuf data of the
matching `*_event` message.

| Event | Impacted |
| --- | --- |
| `registered`, `profile_updated`, `key_rotated` | `account` |
| `device_authorized`, `device_revoked` | `account`, `device` |
| `recovery_policy_set`, `recovery_policy_proposed` | `account`, every guardian of the (new) policy |
| `recovery_policy_cancelled`, `recovery_cancelled` | `account` (also emitted by `execute_recovery` / `apply_recovery_policy` when they void a pending policy change / pending recovery) |
| `recovery_proposed` | `account`, `guardian`, `new_owner` |
| `recovered` | `account`, `previous_owner`, `new_owner` |

Empty optional fields (`profile_hash`, `profile_uri`, `label`) are stored and emitted
as absent so records and events keep the canonical encoding.

## Building and testing

From the repository root:

```sh
node packages/contracts/scripts/build.mjs debug identity     # regenerate bindings + debug wasm
node packages/contracts/scripts/build.mjs release identity   # release wasm + ABI under packages/contracts/build/release
node packages/contracts/scripts/test.mjs identity            # as-pect 8 unit tests on the Koinos mock VM
```

Tests live in `assembly/__tests__/Identity.spec.ts` and cover registration (happy path,
duplicate, unsigned, field validation), the device lifecycle (authorize, resolve,
capability mismatch, expiry through `Testing.setTime`, revoke, overwrite, epoch
expiry after recovery, idempotent revoke), profile updates through devices with and
without the `profile` capability, key rotation versioning, the immediate-then-delayed
recovery policy flow (propose, apply too early, apply, cancel), and full 2-of-3 guardian
recovery (duplicate approval, execute before threshold and before delay, owner
cancel, execute after the delay, lock-out of the previous owner, second recovery,
a policy change voiding in-flight approvals so a removed guardian never counts,
a recovery voiding the previous owner's pending policy change).

Mock VM notes for spec authors: a revert rolls the database back to the last
`MockVM.commitTransaction()`, so commit after each successful call later steps rely
on. The mock keeps every emitted event in a single metadata blob read through the
SDK's 1 KiB system-call buffer; call `MockVM.clearEvents()` before an action whose
event you decode once a test has emitted several large events.
