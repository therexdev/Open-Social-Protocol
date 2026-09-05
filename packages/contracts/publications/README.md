# OSP publications contract

Koinos smart contract for Open Social Protocol publications (protocol v1):
signed, versioned posts and replies, lifecycle facts, non-economic reactions,
audience-key distribution and cross-post outcome records. Normative semantics:
`docs/protocol-spec.md` sections 2.1-2.3 (post ids, idempotency keys, audience
ids), 3.2 (actor resolution) and 6 (publication lifecycle); design rationale:
ADR 0002 (state versus history) and ADR 0003 (authority model). Wire format:
`packages/proto/osp/publications.proto`.

Publication content is history, not state: the encrypted envelope, media
references, key packages and cross-post outcomes travel in call arguments and
are re-emitted in `osp.publications.*` events. Contract state keeps only what
later validation needs: a compact `post_record` per post, the author's
publication sequence, and the idempotency keys already used.

## Layout

| Path | Purpose |
| --- | --- |
| `assembly/Publications.ts` | Contract implementation (class `Publications`) |
| `assembly/index.ts`, `assembly/Publications.boilerplate.ts` | Generated entry-point dispatch (do not edit) |
| `assembly/proto/{publications,identity,relationships}.ts` | Generated message classes (do not edit) |
| `assembly/common/{actor,util,testing}.ts` | Shared helpers copied from `packages/contracts/common` by the build (do not edit) |
| `assembly/__tests__/Publications.spec.ts` | Unit tests (as-pect 8 + Koinos mock VM) |
| `abi/publications.abi` | Generated Koinos ABI |

## Authority model

Every mutating method resolves its signer through the configured identity
contract (`identity.resolve_actor(account, device, capability)`) and then
requires that signer's `contract_call` authority on the current transaction
(`Actor.requireAuthorized`, spec 3.2). With an empty `device` the signer is the
identity owner; otherwise it is an authorized, unexpired device key holding the
capability:

| Method | Capability |
| --- | --- |
| `publish`, first version without `reply_to` | `PUBLISH` (1) |
| `publish`, first version with `reply_to` (a comment) | `COMMENT` (4) |
| `publish`, edit | decided by the **stored** post: `COMMENT` when its `reply_to` is set, else `PUBLISH` |
| `set_lifecycle`, `distribute_keys`, `record_cross_post` | `PUBLISH` (1) |
| `react` | `REACT` (2) |

For edits the caller-supplied `reply_to` never influences the capability: a
comment stays a comment whether or not the client repeats the link, so a device
holding only `PUBLISH` cannot rewrite one and a `COMMENT` device can edit its
comments without re-sending `reply_to` (ADR 0003 bounded-damage model).

Argument validation runs before the identity lookup, so malformed calls revert
without any cross-contract call; for an edit the post record is loaded before
the lookup as well (its thread position selects the capability), so
`post not found` also reverts without one. `set_identity_contract` and
`set_relationships_contract` require the `contract_call` authority of the
contract's own account. Write methods revert with
`identity contract not configured` until the identity contract is set; a reply
to another author's post additionally needs the relationships contract
(`relationships contract not configured`).

## Methods

Entry points are the first 4 bytes of `sha256(method name)`; see
`abi/publications.abi`.

### Admin

| Method | Rules |
| --- | --- |
| `set_identity_contract(address)` | Contract account only; 25-byte address. Replaceable. |
| `set_relationships_contract(address)` | Contract account only; 25-byte address. Replaceable. |

Both addresses live in one config object (`get_dependencies_result`); setting
one keeps the other.

### publish

Common validation (any version):

* `author`: 25-byte address; `post_id` and `content_hash`: exactly 32 bytes.
* `envelope`: at most 4096 bytes. When non-empty, `content_hash` must equal
  `sha256(envelope)` (`content hash mismatch`). When empty, `content_hash` is
  accepted as given (content stored off-chain).
* `audience`: `everyone | friends | custom` (`unknown audience`). `audience_id`:
  at most 32 bytes; required for `custom` (`custom audience requires audience_id`)
  and forbidden for `everyone` and `friends`, whose audience is implicit
  (`audience_id not allowed for this audience`, spec 2.3).
* `media`: at most 8 refs; each `mime` at most 128 chars, `content_hash` empty or
  32 bytes, at most 4 `locations` of at most 256 chars, `key_ref` at most 128
  bytes (opaque key material; bounded so the re-emitted media list cannot carry
  arbitrary bytes past the envelope limit).
* `reply_to`: empty or exactly 32 bytes (`reply_to must be 32 bytes`), checked
  for every version before the identity lookup.
* `idempotency_key`: empty or at most 32 bytes. When present it must be unused
  by this author (`duplicate idempotency key`) and is bound to `post_id`.

First version (`previous_version` empty):

1. `post_id` must be new (`post already exists`).
2. `sequence == author_state.next_sequence` (`sequence mismatch`; the first
   sequence is 1).
3. `post_id == sha256("osp/v1/post-id" || chain_id || u32be(1) || author ||
   u64be(sequence) || content_hash)` (`post id mismatch`, spec 2.1).
4. If `reply_to` is set: 32 bytes, the target post must exist
   (`reply target not found`) and not be `deleted` (`reply target deleted`);
   unless the target is the author's own post, the target author must not have
   blocked the author (`relationships.is_blocked(actor = target author,
   target = author)`; `blocked by author`).
5. Writes `post_record{author, sequence, version_count: 1, latest_version:
   content_hash, state: active, reply_to, audience, created_at, updated_at}`
   and advances the author: `next_sequence += 1`, `post_count += 1`,
   `last_publish_at = now`.

Edit (`previous_version` non-empty):

1. The post must exist (`post not found`, checked before the identity lookup);
   the signer is then resolved with `COMMENT` when the stored `reply_to` is set
   and `PUBLISH` otherwise (see Authority model).
2. The post must belong to the author (`author mismatch`) and not be `deleted`
   (`post deleted`).
3. `previous_version == latest_version` (`stale version`).
4. `audience` must equal the stored audience (`audience change not allowed`).
5. `reply_to`, when supplied, must equal the stored link
   (`reply_to change not allowed`); the thread position is fixed by the first
   version. `sequence` is ignored.
6. `version_count += 1`, `latest_version = content_hash`, `updated_at = now`.
   The author's sequence state is untouched.

`audience_id` and `epoch` are per-version history fields: `post_record` keeps
only the audience kind, so an edit may carry a different `epoch` (the author's
epoch advances on revocation, spec 5.3, and a new version is encrypted under the
current epoch key) and, for a `custom` post, a different `audience_id`. The
contract cannot pin the custom `audience_id` across versions without a
`post_record` schema change; indexers and clients must read both fields from
each `published` event individually rather than from the first version.

Event: `published{author, post_id, content_hash, previous_version,
version_number (= version_count after the call), sequence (stored),
audience, audience_id, epoch, envelope, media, reply_to (stored),
idempotency_key, protocol_version: 1, timestamp}`; impacted `[author]` plus the
reply target's author for replies (first version or edit) to someone else's post.

### set_lifecycle

`author` authorized (`PUBLISH`); `post_id` and `version` 32 bytes; `reason` at
most 256 chars; `state` one of `active | author_hidden | deleted | unavailable |
migrated | superseded`. The post must exist, belong to the author, and `version`
must equal `latest_version` (`version mismatch`). `deleted` is terminal: no
transition out of it (`post deleted`), including re-deleting. `migrated` and
`superseded` require a 32-byte `replacement_id` different from `post_id`; every
other state requires it to be empty (`replacement_id not allowed for this
state`). Non-terminal states may be changed freely, including back to `active`.
Updates `state` and `updated_at`. Event `lifecycle{author, post_id, version,
state, reason, replacement_id, timestamp}` impacted `[author]`.

### react (event only)

`actor` authorized (`REACT`); `post_id` 32 bytes; `reaction != 0`
(`reaction is required`; `1 = like`, other codes are client vocabulary). The
post must exist and not be `deleted` (hidden posts accept reactions). No state
is written. Event `reaction{actor, post_id, post_author, reaction, removed:
remove, timestamp}` impacted `[actor, post_author]` (`[actor]` only for a
reaction to your own post).

### distribute_keys (event only)

`author` authorized (`PUBLISH`); `packages` non-empty and at most 16384 bytes
(an encoded `osp.envelope.key_package_set`); `audience_id` empty (friends
audience) or at most 32 bytes. Event `keys_distributed{author, audience_id,
epoch, packages, timestamp}` impacted `[author]`.

### record_cross_post (event only)

`author` authorized (`PUBLISH`); `idempotency_key` 1..32 bytes; `adapter`
1..64 chars; `external_ref` at most 256 chars; `manifest_hash` empty or 32
bytes; `state` one of `succeeded | partial | unknown | failed |
reconcile_required`. `post_id`, when supplied, must be 32 bytes and name an
existing post of the author; `succeeded` requires it (`post_id is required for
a succeeded outcome`). If the idempotency key is already bound to one of the
author's publications, `post_id` must be that post (`idempotency key bound to
another post`). For `succeeded` the key must be bound: it has to be the key the
author used in `publish` (first version or edit) for `post_id`, so the outcome
resolves back to its attempt through `get_post_by_idempotency_key`
(`idempotency key not bound to a post`, spec 6; a binding by another author does
not count). Other states may report an unbound key, with or without a post,
because the attempt may not have reached the chain. Event
`cross_post_outcome{author, idempotency_key, adapter, state, external_ref,
post_id, manifest_hash, timestamp}` impacted `[author]`.

### Reads (read-only, never call other contracts)

| Method | Result |
| --- | --- |
| `get_post(post_id)` | The `post_record`; `value` null when unknown or the argument is empty. |
| `get_author_state(author)` | `author_state`; `{next_sequence: 1, last_publish_at: 0, post_count: 0}` when the author never published (never null). |
| `get_post_by_idempotency_key(author, idempotency_key)` | `post_ref{post_id}`; null when the key is unused or an argument is empty. |
| `get_limits()` | `{max_envelope_bytes: 4096, max_media_refs: 8, max_key_package_bytes: 16384, max_idempotency_key_bytes: 32, max_location_chars: 256, protocol_version: 1}` |
| `get_dependencies()` | `{identity, relationships}`; each empty until configured. |

## State spaces

| Space id | Map | Key | Value |
| --- | --- | --- | --- |
| 1 | posts | `post_id` (32 bytes) | `post_record{author, sequence, version_count, latest_version, state, reply_to, audience, created_at, updated_at}` |
| 2 | authors | `author` (25 bytes) | `author_state{next_sequence, last_publish_at, post_count}` |
| 3 | idempotency | `author ‖ idempotency_key` (26..57 bytes) | `post_ref{post_id}` |
| 4 | config (single object) | - | `get_dependencies_result{identity, relationships}` |

Post records are never removed; `deleted` is a lifecycle state so that replies,
reactions and edits can be refused deterministically and indexers can keep
tombstones. Envelopes, media, key packages and manifests are never stored.

## Limits and validation

| Limit | Value | Revert message |
| --- | --- | --- |
| envelope | 4096 bytes | `envelope too large` |
| media refs | 8 per post | `too many media refs` |
| media mime | 128 chars | `media mime too long` |
| media content hash | empty or 32 bytes | `media content_hash must be empty or 32 bytes` |
| media locations | 4 per ref, 256 chars each | `too many media locations`, `media location too long` |
| media key_ref | 128 bytes | `media key_ref too large` |
| idempotency key | 32 bytes (`record_cross_post`: 1..32) | `idempotency key too large`, `idempotency_key is required` / `too large` |
| key package set | 1..16384 bytes | `packages is required`, `packages too large` |
| audience id | 32 bytes; `publish`: required for `custom`, empty otherwise | `audience_id too large`, `custom audience requires audience_id`, `audience_id not allowed for this audience` |
| reason / external_ref | 256 chars | `reason too long`, `external_ref too long` |
| adapter | 1..64 chars | `adapter is required`, `adapter too long` |
| hashes (`post_id`, `content_hash`, `version`, `reply_to`, `replacement_id`, `manifest_hash`) | 32 bytes | `<name> must be 32 bytes`, `<name> must be empty or 32 bytes` |
| addresses | 25 bytes | `<name> must be a 25-byte address`, `<name> is required` |

Timestamps (`created_at`, `updated_at`, `last_publish_at`, event `timestamp`)
are the head block time in milliseconds. Hashes are raw 32-byte SHA-256
digests; the contract strips the multihash prefix returned by the `hash`
system call before comparing or emitting them.

## Events

All events are named `osp.publications.<event>` and carry the canonical
encoding of the matching `*_event` message (spec 12): `published`,
`lifecycle`, `reaction`, `keys_distributed`, `cross_post_outcome`. `impacted`
lists the acting account first and any counterparty (reply target author, post
author of a reaction) second. Indexers rebuild every projection from these
events alone; state exists only for on-chain validation.

## Build and test

From the repository root:

```sh
node packages/contracts/scripts/build.mjs debug publications    # regenerate bindings + debug WASM
node packages/contracts/scripts/build.mjs release publications  # release WASM (packages/contracts/build/release/publications.wasm + .abi)
node packages/contracts/scripts/test.mjs publications           # as-pect unit tests
```

The tests run fully offline against the Koinos mock VM. Notes on the mock:

* Cross-contract calls are stubbed with `Testing.mockResolveActor(...)` /
  `MockVM.setCallContractResults(...)`; each `System.call` consumes one queued
  result in order. A first-version reply to someone else's post makes two
  calls (`identity.resolve_actor`, then `relationships.is_blocked`); every other
  write makes one. `Testing.authorize([...])` marks which addresses signed, so
  an "unauthorized signer" test resolves the actor to one address and signs
  with another.
* Post ids are recomputed in the spec with `System.hash` over the same
  concatenation as the contract; `MockVM.setChainId(...)` must be called after
  every reset (the mock throws on `get_chain_id` otherwise) and committed so a
  revert does not roll the metadata away.
* The mock returns events and recorded call arguments through one system-call
  buffer (1 KiB by default); the spec raises it with
  `System.setSystemBufferSize` to read back maximum-size envelope and key
  package events, and clears both lists after building fixtures
  (`MockVM.clearEvents`, `MockVM.clearCallContractArguments`) because recorded
  calls accumulate across commits. A `System.require` revert (exit code 1)
  rolls the recorded call arguments back together with the state, whereas a
  `requireAuthority` failure (a negative exit code) keeps them; assertions on
  the arguments of a cross-contract call therefore belong to successful calls
  or authority failures, not to `System.require` reverts.
* The mock database orders keys by comparing buffers as JavaScript strings,
  which decodes them as UTF-8: byte keys made of invalid UTF-8 sequences
  (for example `0xa1 * 16` versus `0xa2 * 16`) collide in the mock even though
  they are distinct on chain. Test fixtures therefore use ASCII-range bytes for
  idempotency keys.
