# Photos, albums, selected sharing and private groups

This change replaces new photo uploads in the reference web client with an event-backed archive in the publications contract. It requires a coordinated contract, indexer, sponsor and client rollout. It is not enabled by deploying only the web bundle.

## Product behavior

- Profiles have Posts, Photos, Groups and About tabs. Photos contains All photos and Albums. Uploading directly to Photos can optionally create a feed post; otherwise the publication is gallery-only. Images in ordinary posts also appear in the author's photo area.
- Posts and individual photos can be public, friends-only, or private with up to 50 selected accounts, including non-friends. A private post with nobody selected is only readable by its author. Edit / Manage sharing produces a fresh post version and reading key. Removed recipients do not receive that version's key.
- Albums are public or private with selected members. Owners add/remove existing photos without uploading the bytes again. Adding a private album member shares its existing photos as well as later additions. Removing a member rotates the album key and removes current in-app access. Public/private album visibility is immutable to avoid accidental disclosure.
- Groups are private, owner-managed collections with up to 50 additional accounts. Current members can post; the contract rejects removed members and stale membership epochs. The Groups menu lists memberships. New members receive future group posts, not all historical posts written by other members.
- External image URLs remain supported for public posts. They incur no archive-storage units. Existing IPFS photos remain readable using replaceable gateways. The new upload path does not pin images to IPFS.
- The browser extension verifies current group membership and links archived photos to the web client. Album/group management and archived-photo rendering are provided by the reference web client in this release.

### Revocation limits

Revocation controls current application views and future key distribution. It cannot erase earlier bytes or keys from chain history, recipients' caches, downloads, screenshots or other copies. Sharing the same photo through a post and an album creates separate access paths: removing one does not revoke the other. Removing an album entry does not delete its source publication or archive. The UI explains this when managing membership.

Private pixels, captions and collection names are encrypted locally. Account identities, group/album membership, archive sizes, timing and key-routing information remain public metadata. Members can redistribute content they can decrypt. An indexer is not an authorization boundary; clients verify canonical contract state and content hashes.

## Size and usage pricing

Source comparison: Remember Forever repository `therexdev/remember-forever`, commit `8256fd6e66df5cd7e004ffd3850df6cd88f689db`, `src/credits.js` and `src/media.js`. Its photo tiers are 1/2/4/7/10 credits for 32/64/128/224/320 KiB envelopes. Its purchased credits are distinct from Open Social's regenerating usage allowance; these are not equivalent dollar values.

Open Social uses the same tiers for stored image bytes:

| Stored bytes, including encryption overhead | Usage units |
| --- | ---: |
| 1–32 KiB | 1 |
| >32–64 KiB | 2 |
| >64–128 KiB | 4 |
| >128–224 KiB | 7 |
| >224–320 KiB | 10 |

Free allowance is consumed first, then OSAT-backed capacity, using the existing token contract's recharge rules. OSAT holdings are not burned by this feature. One publication costs an additional unit; saving collection metadata or adding/removing an album entry costs one unit. Key distribution has no additional protocol usage charge, though all transactions consume chain resources and sponsor quotas.

The browser prepares JPEGs locally to the chosen budget, with a maximum dimension of 2048 pixels. Private encryption adds 16 bytes; the price uses the final stored size. This is compressed social-photo storage, not retention of a multi-megabyte original. Unlike Remember Forever's combined photo envelope, captions and post metadata are accounted for by the separate publication charge.

These are initial testnet rates, not a validated mainnet storage-cost model. Measure actual Mana, history retention, replication, indexing and retrieval costs before approving production rates. Regenerating free/OSAT capacity does not itself pay operators' fiat costs.

## Archive and access design

`begin_photo` commits the owner, size, whole-image digest and per-chunk digests, and consumes usage once. The exact same reservation is idempotent. `append_photo` stores verified 16 KiB chunks in blockchain events and increments a compact contract-state receipt. Identical chunk retries are safe. Clients accept images only after verifying all chunks against canonical state and the expected whole-image digest.

Encrypted upload bytes, archive ID and encryption material are saved inside the existing encrypted local publication draft before any reservation. An interrupted upload resumes the same reservation without another storage charge. A reserved upload that is abandoned still consumes its units; there is no refund. History availability depends on retained chain history or independent archive replicas, so this implementation does not promise literal permanence without an operational retention plan.

Each selected-account post/version has a distinct audience and key. Group posts use per-post keys distributed only to the membership read from the contract. Album entries wrap existing media keys under collection epoch keys. Names and entries bind their encrypted envelopes to the chain, owner, collection, item and epoch. Added album members receive verified historical album keys; removed members do not receive new epoch keys.

Collection and album-entry writes use compare-and-swap revisions. Current membership is read from the contract before opening collections, adding/removing photos and publishing group posts. Private post and collection views refresh their checks every 30 seconds. Offline verification fails closed.

## Rollout

1. Preserve the existing deployment manifest and back up the indexer database. Retain legacy IPFS pins; this change does not migrate or republish old images.
2. Build proto and SDK, then release publications:
   ```sh
   npm ci
   npm run build -w packages/proto -w packages/sdk
   node packages/contracts/scripts/build.mjs release publications
   ```
3. Review a deployment dry run using the existing deployment credentials and contract seed. Confirm it upgrades the current publications address and preserves its dependencies:
   ```sh
   node --import tsx scripts/deploy-contracts.ts --network harbinger --only publications --dry-run
   ```
   Only after review, run the same command without `--dry-run`. Verify `get_library_version` returns 1 and `get_token_contract` points at the current token contract. Do not bypass the configured usage contract; archive writes fail if it is missing.
4. Deploy the rebuilt indexer. Migration 6 adds the archive/collection tables and post placement fields without resetting existing state. Its `/v1/status` advertises `photoLibrary: 1`. Ensure event history is available from the upgrade block onward and test replay against an independent indexer.
5. Rebuild/restart the sponsor, including its signed discovery and on-chain policy registration. The default policy now includes the four library write methods; actor binding is the owner's account. Maximum encoded operation arguments become 24 KiB. Burst quota becomes 180 operations per minute, enough for eight maximum-size photos (168 storage operations plus publication/key distribution); the existing 200-operation daily quota still applies. Explicit deployment environment overrides must be updated deliberately. The 2-Mana per-operation ceiling is unchanged pending real-chain measurement.
6. Disable the legacy upload adapter by removing `OSP_MEDIA_PROVIDER` after old-client compatibility is assessed. Keep the old media pins and gateway reads; do not unpin historical content. Deploy the web and extension builds. New library actions require the on-chain version probe and will not silently submit to an older contract.
7. Before broad enablement, test on Harbinger with two independent accounts: 32/64/128/224/320 KiB images, free/OSAT allowance changes, interrupted upload recovery, album add/remove, non-friend sharing/revocation, removed group members, stale concurrent membership edits, fresh-device key recovery and archive replay/retrieval. Record real per-operation Mana and adjust sponsor resource ceilings based on measurements. Then approve mainnet pricing and retention operations separately.

## Validation

Local suites: 107 publications contract, 33 token contract, 110 SDK, 66 indexer, 61 sponsor, 285 web and 102 extension tests passed (764 total, plus two existing web skips). Release contract builds, TypeScript builds and web/extension bundle smoke checks passed.

- Publications contract tests: archive size boundaries, owner binding, exact retry idempotency, chunk integrity, usage required, collection CAS, member removal, album tombstones, current group member publication, stale group epochs and removed member rejection.
- SDK: exact tier boundaries, malformed locations, incomplete/reordered/tampered chunks and whole-image integrity.
- Web: selected non-friend encryption, isolated post keys, upload interruption recovery, encrypted album metadata, historical album sharing, revocation, media-key rewrapping and duplicate album-entry avoidance, alongside existing publication tests.
- Indexer: event replay, membership replacement, tombstones and the new schema; sponsor: full-size chunk acceptance and owner/payee rejection; extension: current-membership verification and existing regression suite.
- Browser QA with offline fixtures: desktop and 390-pixel phone layouts, profile photo/album tabs, friend and non-friend search and removal, private upload preparation and cost review, Groups navigation and membership editor; no browser errors or horizontal overflow.
- Live resource accounting, deployment and multi-device real-chain behavior remain release checks, not claims established by offline mocks.
