# OSP registry contract

Well-known discovery point for the Open Social Protocol contract set (protocol v1).
It publishes the active `(name, address, version, abi_hash)` entry for every protocol
contract (`identity`, `relationships`, `publications`, `communities`, `sponsorship`, ...).
Every change is a published, time-locked proposal that the admin can cancel before it
activates; the admin key itself moves through the same time lock. Deprecation is a signal,
not a switch-off: deprecated entries stay readable and listed. Normative semantics:
`docs/protocol-spec.md` section 13; design rationale: ADR 0002. Wire format:
`packages/proto/osp/registry.proto`.

## State spaces

| Space id | Kind | Key | Value |
| --- | --- | --- | --- |
| 1 | `config` (`Storage.Obj`) | - | `registry_config` (admin, upgrade delay, protocol version, pending admin transfer) |
| 2 | `active` (`Storage.Map`) | raw UTF-8 bytes of `name` | `contract_entry` with status `active` or `deprecated` |
| 3 | `proposed` (`Storage.Map`) | raw UTF-8 bytes of `name` | `contract_entry` with status `proposed` (at most one per name) |

State holds one small record per name; every change is also emitted as an event so
indexers can rebuild the history of the contract set from events alone (ADR 0002).

## Authority

| Class | Who signs | May call |
| --- | --- | --- |
| Contract account | the registry's own account (`System.getContractId()`, `contract_call` authority) | `init` (once) |
| Admin | `registry_config.admin` (`contract_call` authority) | `propose_contract`, `cancel_contract`, `deprecate_contract`, `propose_admin`, `cancel_admin` |
| Anyone | no signature required | `apply_contract`, `execute_admin`, all read methods |

Every write method other than `init` reverts with `not initialized` until `init` has run.
The contract account is *not* the admin: after `init` only the configured admin can change
the contract set.

## Limits

| What | Limit |
| --- | --- |
| `upgrade_delay_ms` | `<= 30 days` (2 592 000 000 ms); `0` is allowed (proposals apply in the same block) |
| `protocol_version` | `>= 1` |
| `name` | 1..32 characters of `[a-z0-9_-]` (case-sensitive, ASCII only) |
| `address`, `admin`, `new_admin` | exactly 25 bytes (Koinos address) |
| `version` | `>= 1`; an upgrade must be strictly greater than the active version (gaps allowed) |
| `abi_hash` | empty or exactly 32 bytes (sha256 of the published ABI JSON) |
| `notes` | `<= 256` characters |
| `list_contracts` | at most 100 entries |

Empty `abi_hash` and empty `notes` are stored as unset.

## Methods

### Write methods

| Method | Authority | Rules | Event |
| --- | --- | --- | --- |
| `init(admin, upgrade_delay_ms, protocol_version)` | contract account | may run once (`already initialized`); validates the limits above; stores the config with no pending admin transfer. | none |
| `propose_contract(name, address, version, abi_hash, notes)` | admin | **Bootstrap** - no active entry for `name`: the entry is activated immediately with `status = active`, `effective_at = updated_at = now` (any `version >= 1`). **Upgrade** - an active entry exists: `version` must exceed the active version; the entry is stored in `proposed` with `status = proposed`, `effective_at = now + upgrade_delay_ms`, `updated_at = now`. A new proposal for the same name replaces the pending one and restarts the delay. A deprecated entry can be upgraded. | `contract_activated` (bootstrap) or `contract_proposed` (upgrade) |
| `apply_contract(name)` | anyone | a proposed entry must exist (`no proposed entry for name`) and `now >= effective_at` (`upgrade delay has not elapsed`). Moves the entry to `active` with `status = active`, `updated_at = now` (`effective_at` is kept) and removes it from `proposed`. | `contract_activated` |
| `cancel_contract(name)` | admin | a proposed entry must exist; removes it. The active entry is untouched. | `contract_cancelled` |
| `deprecate_contract(name, notes)` | admin | an active entry must exist (`no active entry for name`) and not already be deprecated (`contract already deprecated`). Sets `status = deprecated`, replaces `notes`, `updated_at = now`; address, version and `abi_hash` are unchanged. | `contract_deprecated` |
| `propose_admin(new_admin)` | admin | `new_admin` is a 25-byte address different from the current admin. Sets `pending_admin` and `admin_transfer_effective_at = now + upgrade_delay_ms`; a new proposal replaces the pending one and restarts the delay. | `admin_proposed` |
| `cancel_admin()` | admin | a pending transfer must exist (`no pending admin transfer`); clears it. | none |
| `execute_admin()` | anyone | a pending transfer must exist and `now >= admin_transfer_effective_at` (`admin transfer delay has not elapsed`). Sets `admin = pending_admin` and clears the pending transfer; delay and protocol version are unchanged. | `admin_changed` |

`now` is the head block time in milliseconds.

### Read methods

| Method | Returns |
| --- | --- |
| `get_contract(name)` | the active entry (`active` or `deprecated`), `null` when unknown or when `name` is empty |
| `get_proposed_contract(name)` | the pending proposal for `name`, `null` when none |
| `list_contracts()` | every active entry (deprecated ones included, pending proposals excluded), sorted by raw name bytes ascending, at most 100 |
| `get_config()` | the `registry_config`, `null` before `init` |

The chain's state store iterates keys in raw byte order, so `list_contracts` reads the
first 100 names in that order; the contract additionally sorts the page itself so the
result order does not depend on the backing store (the mock VM used in tests orders
encoded keys by length first).

## Events

Names follow `osp.registry.<event>`; data is the canonical encoding of the matching
`*_event` message. `impacted` lists the affected contract address first, then the admin
(deduplicated when equal).

| Event | Emitted by | Data | Impacted |
| --- | --- | --- | --- |
| `osp.registry.contract_activated` | `propose_contract` (bootstrap), `apply_contract` | `name, address, version, timestamp` | `[address, admin]` on bootstrap; `[address]` on apply |
| `osp.registry.contract_proposed` | `propose_contract` (upgrade) | `name, address, version, abi_hash, effective_at` | `[address, admin]` |
| `osp.registry.contract_cancelled` | `cancel_contract` | `name, timestamp` | `[proposed address, admin]` |
| `osp.registry.contract_deprecated` | `deprecate_contract` | `name, address, version, timestamp` | `[address, admin]` |
| `osp.registry.admin_proposed` | `propose_admin` | `new_admin, effective_at` | `[new_admin, admin]` |
| `osp.registry.admin_changed` | `execute_admin` | `previous_admin, new_admin, timestamp` | `[new_admin, previous_admin]` |

`init` and `cancel_admin` emit no event.

## Revert messages

`not initialized`, `already initialized`, `authorization failed` (SDK), `admin is required`,
`admin must be a 25-byte address`, `upgrade_delay_ms too large`, `protocol_version must be >= 1`,
`name is required`, `name too long`, `name must match [a-z0-9_-]`, `address is required`,
`address must be a 25-byte address`, `version must be >= 1`, `abi_hash must be empty or 32 bytes`,
`notes too long`, `version must be greater than the active version`, `no proposed entry for name`,
`upgrade delay has not elapsed`, `no active entry for name`, `contract already deprecated`,
`new_admin is required`, `new_admin must be a 25-byte address`,
`new_admin must differ from the current admin`, `no pending admin transfer`,
`admin transfer delay has not elapsed`.

## Deployment flow

1. Upload the registry WASM/ABI and call `init` from the registry account with the
   admin address, the upgrade delay and `protocol_version = 1`.
2. As admin, `propose_contract` every deployed protocol contract once: with no active
   entry yet each call activates immediately (bootstrap).
3. To upgrade a contract, deploy the new version, `propose_contract` it with a higher
   `version`, wait for `effective_at`, then anyone calls `apply_contract`. Cancel with
   `cancel_contract` before that if needed.
4. Mark superseded versions with `deprecate_contract`; clients pinning the old version
   keep working (spec section 13).

## Build and test

From the repository root:

```sh
node packages/contracts/scripts/build.mjs debug registry     # regenerate bindings + debug WASM
node packages/contracts/scripts/build.mjs release registry   # release WASM + ABI (build/release/registry.*)
node packages/contracts/scripts/test.mjs registry            # as-pect 8 + Koinos mock VM unit tests
```

Tests live in `assembly/__tests__/Registry.spec.ts` and cover initialization (once, contract
account only, limits), bootstrap activation, version checks, the apply/cancel time lock
(before, at and after `effective_at`, zero delay), deprecation, the admin transfer
lifecycle, non-admin rejection for every admin method, event names/data/impacted and
`list_contracts` ordering and cap. They run fully offline against the mock VM.
