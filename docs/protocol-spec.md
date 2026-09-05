# Open Social Protocol v1 - Normative Specification (Draft 1.2 implementation)

Status: implementation draft for the Koinos Harbinger testnet pilot. Schemas are
versioned (`protocol_version = 1`). Anything marked *pilot* is expected to change
before mainnet and must not be relied upon for permanence guarantees.

This document is the shared source of truth for the contracts (`packages/contracts`),
the SDK (`packages/sdk`), the indexer (`apps/indexer`), the sponsor (`apps/sponsor`),
the web client (`apps/web`) and the extension (`apps/extension`). Where this text
and the `.proto` files disagree, the `.proto` files win for wire format and this
text wins for semantics.

## 1. Planes and trust boundaries

| Plane | Component | Canonical? |
| --- | --- | --- |
| Consensus | Koinos contracts (`identity`, `relationships`, `publications`, `communities`, `sponsorship`, `registry`) | Yes, per protocol version |
| Content | Encrypted envelopes in call arguments / events; content-addressed media in external stores | Integrity canonical (hashes); availability not guaranteed |
| Query | Indexers rebuilt from chain history | No. Must be reproducible |
| Experience | Web client, extension, any conforming client | No |
| Sponsorship | Any payer service | No. Replaceable, refusal never removes permission |

The Koinos transaction accepted by a protocol contract is authoritative. Frontends,
indexers, storage providers and sponsors are untrusted conveniences. A feature is
"decentralized" only if an independent team can reproduce it from open data without
permission from the founding team.

## 2. Identifiers, encodings and domain separation

* Addresses are 25-byte Koinos addresses (Base58 in JSON, `(koinos.btype) = ADDRESS`).
* Hashes are raw 32-byte SHA-256 digests unless stated otherwise (no multihash prefix
  inside protocol structures; Koinos transaction/block ids keep their multihash form).
* All protocol integers are big-endian when concatenated for hashing.
* Every hashed or signed protocol payload starts with a domain separator (ASCII bytes):

| Purpose | Domain separator |
| --- | --- |
| Post id | `osp/v1/post-id` |
| Content-key wrap AAD | `osp/v1/wrap` |
| Sealed epoch key AAD | `osp/v1/seal` |
| Proof manifest signature | `osp/v1/manifest` |
| Audience id (custom) | `osp/v1/audience` |
| Idempotency key derivation | `osp/v1/idem` |
| Encryption key derivation (from account seed) | `osp/v1/enc-key` |

Canonical Protobuf encoding: fields in ascending field-number order, default values
omitted, no `map<>` fields in any hashed or signed structure, unknown fields ignored
by readers but never re-serialized into a signed payload.

### 2.1 Post id

```
content_hash = sha256(envelope_bytes)
post_id      = sha256("osp/v1/post-id" || chain_id || u32be(protocol_version)
                      || author(25) || u64be(sequence) || content_hash)
```

`chain_id` is the raw bytes of the Koinos chain id (the JSON-RPC `chain.get_chain_id`
value base64url-decoded, multihash prefix included). `sequence` is the author's strictly
increasing publication sequence (1-based). The publications contract recomputes and
enforces `post_id` for every first version. A version is identified by its
`content_hash`. Edits publish a new version under the same `post_id` with
`previous_version = latest content_hash`.

### 2.2 Idempotency key

Clients derive `idempotency_key = sha256("osp/v1/idem" || author || client_attempt_id)[0..16]`
(16 bytes) where `client_attempt_id` is a locally persisted random 16-byte value created
when the user first confirms the publication. The key is stored on chain per author;
re-submitting the same key reverts with `duplicate idempotency key`, and clients then
resolve the existing post via `get_post_by_idempotency_key`.

### 2.3 Audience ids

* `everyone` (0): `audience_id` empty. Envelope suite 0 (plaintext).
* `friends` (1): `audience_id` empty, meaning the author's friends audience; `epoch` is
  the author's current `relationships.audience_state.epoch`.
* `custom` (2): `audience_id = sha256("osp/v1/audience" || author || label)[0..16]`;
  membership is client-managed and reflected only through `distribute_keys`.

## 3. Identity and authority

An identity is a Koinos account address. `identity.register` publishes an X25519
encryption key (32 bytes), a key version and a profile document reference. The
identity's `owner` is the address whose signature authorizes administrative actions;
it equals `account` until a guardian recovery replaces it.

### 3.1 Authority classes (v1)

| Class | Who | Allowed |
| --- | --- | --- |
| Owner (recovery + administration) | `identity_record.owner` | Everything, including key rotation, device authorization, recovery policy, block/unblock |
| Device/session | `device_record` with capability bits, expiry and `device_epoch` | Only the capability's actions, never assets, never administration |
| Guardian | addresses in `recovery_policy.guardians` | Propose/approve owner replacement under delay |

Capability bits: `1 publish`, `2 react`, `4 comment`, `8 relationships`,
`16 community`, `32 profile`. Devices cannot block or unblock (owner only), cannot
rotate keys, cannot authorize other devices.

### 3.2 Actor resolution (normative)

Every mutating method that takes an `actor`/`author`/`requester` plus an optional
`device` resolves the required signer through `identity.resolve_actor(account,
device, capability)`:

1. Identity must exist, else `ok=false, reason="unregistered"`.
2. If `device` is empty or equals `account`: `signer = owner`.
3. Otherwise the device record must exist, be unrevoked, have
   `device_epoch == identity.device_epoch`, `expires_at > head_block_time` and
   `(capabilities & capability) != 0`; then `signer = device`.

The calling contract then requires `contract_call` authority of `signer` on the
current transaction. The identity contract never checks signatures for other contracts.

### 3.3 Recovery

* First `set_recovery_policy` applies immediately; later changes are pending for
  `delay_ms` and can be cancelled by the owner.
* `propose_recovery(account, guardian, new_owner)` records a guardian approval for
  `new_owner`; approvals for a different `new_owner` restart the set. When approvals
  reach `threshold`, `effective_at = now + delay_ms`.
* `cancel_recovery` by the current owner voids the pending recovery (recent-key proof).
* `execute_recovery` after `effective_at` sets `owner = new_owner`, increments
  `device_epoch` (voiding all devices) and emits `osp.identity.recovered`.
* Recovery never reveals historical plaintext: encryption keys are backed up
  separately by the client (see 5.5).

## 4. Relationships

* `request_friend` creates a `pending` edge (requester recorded). Requires that
  neither party has blocked the other and both identities exist.
* `accept_friend` by the recipient makes the edge `active`; `nonce` increments.
* `remove_friend` by either side makes the edge `inactive` and advances the actor's
  audience epoch (`osp.relationships.audience_rotated`, reason `friend_removed`).
* `block` (owner only) marks `(actor, target)` blocked, sets any edge `inactive`,
  removes follows in both directions and advances the actor's epoch.
* `follow` / `unfollow` are unilateral; blocked pairs cannot follow.
* `rotate_audience` advances the epoch manually.

Relationship state is public metadata (whitepaper section 4).

## 5. Encrypted publication

### 5.1 Envelope (suite 1: XChaCha20-Poly1305 + X25519/HKDF-SHA256)

```
content_key   = random(32)
nonce         = random(24)
aad_bytes     = canonical(envelope.aad{protocol_version, chain_id, author, post_id, audience, audience_id, epoch, version_number})
payload       = XChaCha20-Poly1305(content_key, nonce, canonical(content), aad_bytes)
wrap_nonce    = random(24)
wrapped_key   = XChaCha20-Poly1305(epoch_key, wrap_nonce, content_key, "osp/v1/wrap" || aad_bytes)
envelope      = {version:1, suite:1, payload, nonce, wrapped_content_key: wrapped_key, wrap_nonce}
```

`post_id` inside the AAD is a circular dependency for first versions (post_id depends
on content_hash which depends on the envelope). Therefore the AAD for `version_number
== 1` uses `post_id = empty` and clients verify the recomputed post_id from the chain
record instead; for later versions the AAD carries the real `post_id`.

Suite 0 (`everyone`) stores `payload = canonical(content)` in the clear.

### 5.2 Audience epoch keys

`epoch_key = random(32)` per (author, audience_id, epoch). It is sealed for each
member with the member's current identity encryption key:

```
eph            = X25519 keypair
shared         = X25519(eph.secret, recipient_pub)
seal_key       = HKDF-SHA256(ikm = shared, salt = eph.pub || recipient_pub, info = "osp/v1/seal", len = 32)
nonce          = random(24)
ciphertext     = XChaCha20-Poly1305(seal_key, nonce, epoch_key, aad = author || audience_id || u32be(epoch) || recipient)
sealed_key     = {recipient, recipient_key_version, ephemeral_public_key: eph.pub, nonce, ciphertext}
```

Sealed keys are published through `publications.distribute_keys` as an encoded
`key_package_set`. The author always includes itself as a recipient so every device
of the author can recover the epoch key from chain history. Pilot limit: 16 KiB per
`distribute_keys` call (roughly 120 recipients); larger audiences split into
multiple calls for the same epoch.

### 5.3 Revocation semantics

Removing or blocking a friend advances the author's epoch. Future posts use the new
epoch key, which the removed member never receives. Nothing in this protocol can
recall keys or plaintext already delivered. Clients must display this honestly.

### 5.4 History access for new friends

When a friendship is accepted the author's client chooses a policy: `future-only`
(default; nothing extra), `recent-window`, `all-history` or `manual`. Historical access
is granted by sealing the selected historical epoch keys to the new friend in an
additional `distribute_keys` call for each past epoch.

### 5.5 Key storage

Clients keep the signing seed and the X25519 secret in an encrypted local vault
(scrypt-derived key from a passphrase, or a WebAuthn-PRF-derived key when available).
The encryption secret is derived from the seed as
`HKDF-SHA256(seed, "osp/v1/enc-key", u32be(key_version))` so an exported seed restores
decryption ability; recovery of *control* (owner replacement) does not.

## 6. Publications lifecycle

* `publish` first version: verifies identity, sequence (`== next_sequence`), post_id,
  `content_hash == sha256(envelope)` when the envelope is non-empty, size limits,
  idempotency key uniqueness, reply target existence and that the reply target's author
  has not blocked the actor. Emits `osp.publications.published` (event carries the
  full envelope: this is the history path; contract state keeps a compact `post_record`).
* `publish` edit: `post_id` exists, author matches, `previous_version == latest_version`,
  `version_number = version_count + 1`, sequence ignored.
* `set_lifecycle`: author sets `active | author_hidden | deleted | unavailable |
  migrated | superseded`. `deleted` is terminal for versions. Indexers stop hydrating
  deleted/hidden content but never claim erasure.
* `react`: emits `osp.publications.reaction` for an existing, non-deleted post. Reactions
  are non-economic; indexers keep only the latest state per (actor, post, reaction).
* `record_cross_post`: records `{idempotency_key, adapter, state, external_ref,
  post_id, manifest_hash}` as an event. The idempotency key must belong to the author
  and refer to an existing post when `state = succeeded`.

Limits (pilot, enforced on chain and exposed by `get_limits`): envelope 4096 bytes,
8 media refs, 4 locations per ref of at most 256 chars, idempotency key 32 bytes,
key package set 16384 bytes, reason strings 256 chars.

## 7. Cross-platform reconciliation (state machine)

Every cross-post attempt has a persisted local record:

```
{ idempotencyKey, attemptId, hostSite, audience, state, hostRef?, koinosTxId?, postId?, lastError?, updatedAt }
state ∈ { draft, submitting, succeeded, partial, unknown, failed, reconcile_required }
```

| Scenario | Normative client behavior |
| --- | --- |
| Host succeeds, Koinos fails | keep `hostRef`, retry only the Koinos publication with the same idempotency key |
| Koinos succeeds, host fails | keep `postId`, retry only the host publication; never republish on Koinos |
| Koinos result unknown (timeout) | `get_post_by_idempotency_key` and indexer lookup before any retry |
| Indexer lags after chain acceptance | rebuild/poll; never republish |
| Duplicate submission | the contract rejects the duplicate idempotency key; resolve to the existing post |

Once both sides are known, the client signs a proof manifest (section 8) and calls
`record_cross_post`.

## 8. Proof manifest

`envelope.proof_manifest` binds author, post_id, content_hash, version, Koinos
transaction id and height, audience, epoch, storage refs, adapter, external ref,
outcome and idempotency key. Signature: secp256k1 (Koinos account signature) over
`sha256("osp/v1/manifest" || canonical manifest bytes with signature and signer empty)`.
`manifest_hash = sha256(canonical manifest bytes including signature)` is what
`record_cross_post` stores.

## 9. Communities

Roles: `guest(1) < member(2) < moderator(3) < admin(4) < owner(5)`; `banned(6)`.
Owner may set any role except owner; admin may set roles below admin; roles carry
`scope` and `expires_at`. Ownership transfer is time-locked by `transfer_delay_ms` and
cancelable. Labels (`set_label`) are moderation facts emitted as events; they never
alter publication validity. Community policies are documents referenced by hash.

## 10. Sponsorship (Mana)

A sponsor is a payer. The user signs the transaction as payee (the user's nonce is
used), the sponsor validates and co-signs as payer, then broadcasts. Sponsor policy is
public: registered on chain (`sponsorship.set_sponsor`) and served from the endpoint
(`GET /.well-known/osp-sponsor.json`). A conforming sponsor:

1. parses the complete transaction and accepts only `call_contract` operations whose
   `(contract_id, entry_point)` are allowlisted;
2. enforces per-operation byte and RC ceilings and per-user daily/burst quotas;
3. never modifies operations after the user signature; it only appends its signature;
4. reports aggregate utilization and stable refusal categories
   (`quota_exceeded`, `method_not_allowed`, `too_large`, `chain_mismatch`,
   `invalid_signature`, `invalid_transaction`, `temporarily_unavailable`), with HTTP
   status 429 / 403 / 413 / 400 / 400 / 400 / 503 respectively; a transaction whose
   outcome is unknown after broadcast (RPC timeout) is reported as a 200 response whose
   receipt carries `rpc_error`, never as a refusal, so clients treat it as `koinosUnknown`
   and reconcile instead of re-submitting;
5. can be replaced by any other sponsor or by self-pay without an identity change.

Sponsor HTTP API (`docs/sponsor-api.md`): `POST /v1/sponsor` with `{ transaction }`
returns `{ transaction, receipt }` or `{ error: { category, message } }`.

## 11. Indexer requirements

* Deterministic rebuild from a configured start height; deleting the database and
  replaying must reproduce identical authoritative projections.
* Process only events whose `source` is a configured protocol contract address; decode
  `data` with `@osp/proto` descriptors.
* Maintain a reversible window: blocks above the last irreversible block may be rolled
  back when a fork is detected (block id mismatch at a height). Checkpoint every N blocks
  with `(height, block_id, state_hash)`.
* Never store plaintext of encrypted posts; envelopes are stored as bytes.
* Expose `/v1/status`, `/v1/profiles/:account`, `/v1/graph/:account`,
  `/v1/feed`, `/v1/posts/:postId`, `/v1/notifications/:account`,
  `/v1/keys/:account` (sealed keys addressed to the account), and
  `/v1/conformance/state-hash?height=` for cross-indexer comparison.

## 12. Events

Event names are `osp.<contract>.<event>` with `<event>` the proto message name without
the `_event` suffix, e.g. `osp.publications.published`. `impacted` always includes the
acting account and any counterparty. Event data is the canonical encoding of the
corresponding `*_event` message.

## 13. Versioning and evolution

* `registry` publishes the active contract set; changes are time-locked proposals.
* Clients pin `protocol_version = 1` and ignore unknown optional fields.
* Deprecation is a signal; older versions stay readable.
* Golden vectors (`packages/sdk/vectors/`) cover ids, envelopes, sealed keys,
  manifests and reconciliation transitions; independent implementations must pass them.

## 14. Non-goals in v1

Hidden graph metadata, erasure of delivered plaintext, direct messaging, protocol tokens,
stake-weighted ranking in the base feed, remote-hosted extension code.
