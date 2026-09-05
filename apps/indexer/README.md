# @osp/indexer

A replayable indexer for Open Social Protocol on Koinos plus the **INDEXER API v1** consumed by the
web client and the extension. It polls `chain.get_blocks`, keeps only events emitted by the six
protocol contracts of a deployment manifest, decodes them with the `@osp/proto` descriptors (via
`@osp/sdk`), stores them in an append-only event log and derives every query table from that log.

Design rules (docs/protocol-spec.md section 11, docs/adr/0006-indexer-determinism.md):

* **Deterministic rebuild.** Projections are a pure function of the event log. Deleting the database
  and replaying from the configured start height reproduces identical tables and identical state hashes.
* **Reversible window.** Blocks above the last irreversible block (LIB) can be rolled back. A fork is
  detected when a block's `header.previous` is not the stored id at `height - 1` (or when the stored tip
  is no longer the canonical block at its height). The indexer then deletes the log above the last final
  checkpoint, truncates the projections and replays the log.
* **Checkpoint per block:** `(height, block_id, previous_id, timestamp, state_hash)`.
* **Never stores plaintext.** Envelopes and sealed keys are opaque bytes; the indexer has no keys.
* **Untrusted convenience.** Anything served here is reproducible from open chain data by anyone; a
  client can point at any indexer (or run its own, see below).

## Running your own indexer (replacement path)

```sh
npm install                                  # at the repository root
npm run build -w packages/proto -w packages/sdk -w apps/indexer
OSP_NETWORK=harbinger npm run start -w apps/indexer      # or: npm run indexer (root)
curl http://127.0.0.1:8787/v1/status
```

The indexer reads `deployments/<network>.json` (written by the deploy-testnet workflow, see
`deployments/README.md`). **If the manifest does not exist yet the indexer still starts** in a clearly
reported "not deployed" state: `/v1/status` answers `healthy: false, deployed: false` with a `message`,
and every data route answers `503 { error: { code: "not_deployed" } }`.

Point the web client / extension at your instance (Settings, or `VITE_OSP_INDEXER_URL`) and, if you
want it discoverable, add its URL to the `indexers` array of the deployment manifest.

Development: `npm run dev -w apps/indexer` (tsx, no build step).

### CLI

```
node dist/main.js [options]
  --rebuild            delete the database and replay the chain from the start height
  --once               sync to the chain head, print { indexed: { height, id, stateHash } } and exit (no API)
  --no-sync            serve the API from the existing database without syncing
  --network <name>     OSP_NETWORK
  --port <port>        OSP_INDEXER_PORT
  --host <host>        OSP_INDEXER_HOST
  --db <path>          OSP_INDEXER_DB
  --rpc <urls>         OSP_RPC (comma-separated)
  --start-height <h>   OSP_START_HEIGHT
```

`npm run rebuild -w apps/indexer` and `npm run state-hash -w apps/indexer` are shortcuts for
`--rebuild` and `--once`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `OSP_NETWORK` | `harbinger` | Loads `deployments/<network>.json` |
| `OSP_DEPLOYMENT` | `deployments/<network>.json` | Explicit manifest path |
| `OSP_DEPLOYMENTS_DIR` | `<repo>/deployments` | Directory of manifests |
| `OSP_RPC` | manifest `rpc`, else the SDK network preset | Comma-separated JSON-RPC endpoints (failover in order) |
| `OSP_INDEXER_DB` | `./data/indexer-<network>.sqlite` | SQLite file (`:memory:` for tests) |
| `OSP_INDEXER_PORT` | `8787` | API port |
| `OSP_INDEXER_HOST` | `0.0.0.0` | API bind address |
| `OSP_START_HEIGHT` | manifest `startHeight`, else `1` | First block to index |
| `OSP_POLL_INTERVAL_MS` | `2000` | Head poll interval |
| `OSP_BATCH_SIZE` | `50` | Blocks fetched per `get_blocks` call |
| `OSP_REVERSIBLE_WINDOW` | unset | When set, blocks below `head - window` count as final even if LIB lags |

Storage is `node:sqlite` (Node 22, built in; the `start`/`dev` scripts pass `--experimental-sqlite`,
which is accepted on every 22.x release). WAL mode is enabled for file databases.

## Storage layout

Authoritative log (never derived):

* `checkpoints(height, block_id, previous_id, timestamp, state_hash, event_count)`
* `event_log(height, tx_index, sequence, block_id, block_timestamp, tx_id, contract, name, data, data_json, impacted_json)`
  where `data` is the raw base64url event payload (replayed through `decodeEventData`) and `data_json`
  the decoded JSON view served by `/v1/events`.

Projections (truncated and rebuilt from the log on rollback / rebuild): `identities`, `devices`,
`relationships`, `blocks_list`, `follows`, `audiences`, `posts`, `post_versions`, `reactions`,
`key_packages` (one row per sealed key), `cross_posts`, `communities`, `roles`, `labels`, `sponsors`,
`user_grants`, `registry_entries`, `notifications`.

Ordering key everywhere: `(height, tx_index, sequence)` where `sequence` is the event's position within
its transaction receipt. Events of reverted transactions are ignored.

### Projection semantics

* **Publications.** `published` inserts a post and its version 1; later versions update the latest fields
  and add a `post_versions` row. `lifecycle`: a later event wins, `deleted` (2) is terminal. Listings
  (`/v1/feed`, `/v1/accounts/:a/posts`, `/v1/posts/:id/replies`) exclude `author_hidden` (1) and
  `deleted` (2) posts; `/v1/posts/:id` still returns them with their state. Replies never appear in feeds.
* **Reactions.** Latest state per `(actor, post, reaction)`; `removed = true` deletes the row.
* **Keys.** `keys_distributed` packages are parsed with `parseKeyPackageSet`; every sealed key becomes a
  `key_packages` row addressed to its recipient (a malformed package set is kept in the log but projects nothing).
* **Relationships.** Pairs are stored under the sorted `(a, b)` key; `blocked` mirrors the contract
  (edge becomes inactive with `nonce + 1`, follows removed both ways). Epoch history comes from
  `audience_rotated`.
* **Notifications** (derived, per spec): `friend_request` and `friend_accepted` to the counterparty,
  `reaction` and `reply` to the post author, `keys` to every recipient (except the author itself), `role`
  to the subject, `label` to the post author, `recovery` (proposed / executed) and `device`
  (authorized / revoked) to the account. Self-notifications are never created.

## Rebuild and conformance

```sh
# wipe and replay
npm run rebuild -w apps/indexer
# or, without serving: print the tip and its state hash and exit
node apps/indexer/dist/main.js --once
# compare with another indexer at the same height
curl "https://other-indexer/v1/conformance/state-hash?height=123456"
curl "http://127.0.0.1:8787/v1/conformance/state-hash?height=123456"
```

The state hash is a chain over the decoded protocol events of every block:

```
stateHash(h) = sha256( stateHash(h - 1) || utf8(canonicalJson(events(h))) )
stateHash(startHeight - 1) = "" (no bytes)
```

`events(h)` is the array of the block's decoded protocol events in canonical order, each as
`{ height, blockId, txIndex, txId, sequence, contract, name, data, impacted }`, with `data` exactly as
`/v1/events` serves it (bytes as base64url, uint64 as decimal strings, addresses Base58, enums as
numbers, every scalar present) and `canonicalJson` from `@osp/sdk` (keys sorted recursively, no
whitespace). Hashes are lowercase hex. An empty block still advances the hash. Two indexers with the
same deployment and start height must agree at every height; `--rebuild` must reproduce the value.

## API reference (v1)

All responses are JSON; addresses are Base58 strings; bytes (ids, hashes, envelopes, sealed keys) are
base64url strings; uint64 values (heights, timestamps in ms, nonces, sequences) are decimal strings;
cursors are opaque strings; CORS is enabled for every origin. Errors are
`{ "error": { "code", "message" } }` with 400 (`invalid_request`, `invalid_address`, `invalid_cursor`),
404 (`not_found`) or 503 (`not_deployed`).

| Route | Result |
| --- | --- |
| `GET /v1/status` | `{ network, chainId, contracts, head: { height, id }, lastIrreversible, indexed: { height, id, stateHash }, startHeight, healthy, version, deployed, sync: { running, lastSyncAt, lastError, lag, rollbacks }, rpc }` |
| `GET /v1/profiles/:account` | `{ account, owner, encryptionKey, keyVersion, profileHash, profileUri, protocolVersion, deviceEpoch, registeredAt, updatedAt, counts: { posts, friends, followers, following }, recovery: { policy, pendingPolicy, pendingRecovery }, devices: [...] }` or 404 |
| `GET /v1/profiles?query=<address prefix>&limit=` | `{ items: [profile summary] }` (exact match first) |
| `GET /v1/graph/:account` | `{ account, friends: [{ account, since, nonce }], pendingIncoming: [{ account, requestedAt, nonce }], pendingOutgoing: [...], followers: [account], following: [account], blocked: [account], blockedBy: [account], audienceEpoch }` |
| `GET /v1/feed?viewer=&scope=public\|friends\|all&cursor=&limit=` | `{ items: [PostView], nextCursor }` - `public`: everyone-audience posts; `friends` (viewer required): posts by the viewer's active friends plus the viewer's own, any audience; `all`: the union. With a viewer, authors the viewer blocked are excluded. Newest first by `(blockHeight, txIndex, sequence)` of the first version. |
| `GET /v1/accounts/:account/posts?cursor=&limit=` | `{ items: [PostView], nextCursor }` (includes replies) |
| `GET /v1/posts/:postId?viewer=` | `PostView` (404 when unknown; deleted/hidden posts are returned with their `state`) |
| `GET /v1/posts/:postId/replies?cursor=&limit=` | `{ items: [PostView], nextCursor }` |
| `GET /v1/notifications/:account?since=&limit=` | `{ items: [{ id, kind, actor, postId?, communityId?, data, timestamp, blockHeight }], nextCursor }` in arrival order; without `since` the most recent `limit` items, with `since` (a previous `nextCursor`) only newer ones |
| `GET /v1/keys/:account?author=&audienceId=&epoch=&limit=` | `{ items: [{ author, audienceId, epoch, recipient, recipientKeyVersion, sealedKey, blockHeight, txId, timestamp }] }` - sealed epoch keys addressed to `:account`; `sealedKey` is the encoded `osp.envelope.sealed_key` |
| `GET /v1/audiences/:author?audienceId=` | `{ author, audienceId, epoch, epochs: [{ epoch, since, reason }] }` (friends audience from `audience_rotated`; custom audiences from key distributions) |
| `GET /v1/communities/:id` | community record + `roles: [{ subject, role, scope, expiresAt, grantedBy, grantedAt }]` |
| `GET /v1/labels?postId=&communityId=&limit=` | `{ items: [{ communityId, postId, label, reason, actor, timestamp, blockHeight, txId }] }` |
| `GET /v1/sponsors` | `{ items: [{ sponsor, endpoint, policyVersion, active, registeredAt, updatedAt }] }` (the fields carried by `sponsor_set` events; the full policy is served by the sponsor's `/.well-known/osp-sponsor.json` and by `sponsorship.get_sponsor`) |
| `GET /v1/registry` | `{ items: [{ name, address, version, abiHash, status, effectiveAt, updatedAt }] }` |
| `GET /v1/events?fromHeight=&limit=` | `{ items: [{ height, blockId, txId, txIndex, sequence, contract, name, data, impacted }], nextHeight }` - the decoded log, whole blocks per page; `nextHeight` is `null` at the indexed tip |
| `GET /v1/conformance/state-hash?height=` | `{ height, blockId, stateHash }` (latest when `height` is omitted; 404 when not indexed) |
| `GET /health` | `200 { healthy: true }` or `503 { healthy: false }` |

`PostView`:

```
{ postId, author, sequence, versionNumber, contentHash, previousVersion, audience: 0|1|2, audienceId, epoch,
  envelope, media: [{ contentHash, mime, size, locations, keyRef }], replyTo, state, stateReason, replacementId,
  createdAt, updatedAt, txId, blockHeight, reactions: { total, byType: { "1": n }, viewer?: [types] },
  replyCount, versions: [{ contentHash, versionNumber, txId, blockHeight, timestamp }],
  labels: [{ communityId, postId, label, reason, actor, timestamp, blockHeight, txId }] }
```

`envelope` is the latest version's envelope; `txId`/`blockHeight` refer to the first version (the post's
position), `versions[]` carries the per-version transaction. `healthy` is true when a deployment is
loaded, the last sync step succeeded and the indexed tip lags the head by at most `2 * OSP_BATCH_SIZE`.

## Tests

`npm test -w apps/indexer` runs vitest against a `FakeProvider` (no network): a scripted history
(registrations, friend flow, public and friends posts with real envelopes and sealed keys, reactions,
a reply, an edit, lifecycle changes, community role and label, sponsor, registry, device, recovery,
block + audience rotation, plus foreign and reverted events that must be ignored) exercised through
every API route with `fastify.inject`; determinism (two indexers, identical hashes and output);
reorgs (fork above LIB, shorter canonical chain, refusal below the final height); `--rebuild`
reproducibility; not-deployed mode. `npm run typecheck -w apps/indexer` checks sources and tests.
