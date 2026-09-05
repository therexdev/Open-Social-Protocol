# ADR 0002: Contract modules and state-versus-history

Status: accepted (2026-09)

## Context
The technical plan suggests identity, relationship, publication, sponsorship-policy and
protocol-registry modules, compact active state, and event history as the immutable record.

## Decision
Six contracts, each with its own account/address and schema (`packages/proto/osp/*.proto`):
`identity`, `relationships`, `publications`, `communities`, `sponsorship`, `registry`.

* Active state holds only facts required for validation: identity keys/devices/recovery,
  relationship status/epochs/blocks/follows, compact post records (author, latest version,
  lifecycle state, sequence), idempotency keys, community records/roles, sponsor records,
  registry entries.
* Publication content (envelopes, media refs, key packages, cross-post outcomes) is
  carried only in call arguments and emitted events; never duplicated into state.
* Events are named `osp.<contract>.<event>` with canonical protobuf data and `impacted`
  addresses so account-history services can discover them.
* Cross-contract dependencies are configured once at deployment by the contract's own
  account (`set_identity_contract`, `set_relationships_contract`) and published through
  the registry.

## Consequences
Indexers can rebuild every projection from events alone; state stays small and cheap to
validate. Upgrading a contract means deploying a new version and publishing it through the
time-locked registry; history remains readable.
