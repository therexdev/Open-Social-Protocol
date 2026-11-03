# Music: uploads, audiences, OSAT access and comments

Profiles have a Music tab. Each completed track has its own `/music/:id` page with
an artist name, description, verified player, comments, replies and comment
deletion. Group tracks also appear on their group page. Artist names are supplied
by uploaders; they are not verified artist identities.

## Visibility and access

- **Public, free:** anyone can download and play the original on-chain audio.
- **Friends only:** audio and comments are encrypted. Current friendship and
  blocks are checked on chain before a new reading key is delivered.
- **Group:** audio and comments are encrypted. Current group membership and
  closure are checked on chain before key delivery.
- **OSAT unlock:** optional for any audience. A price does not override friends
  or group membership. Only whole transferable OSAT can pay, not free usage
  credits or tokens still recharging.

Titles, artist names, descriptions, uploader addresses, audience/group references,
prices, purchase records and comment routing metadata are public. The upload
form states this explicitly. The audience options restrict audio and comment
content; they do not conceal the existence of a track. Do not put secrets in a
track's title or description.

Private and paid files are encrypted with a random XChaCha20-Poly1305 key before
chunking. Authenticated data binds ciphertext and recipient-sealed keys to the
chain, publications contract and track. The uploader's sealed recovery key is
stored with the manifest; another device with the same identity seed can recover
it. No server receives the plaintext audio key. Private comments bind their track,
comment id and author into authenticated data.

Free private uploads deliver sealed keys to verified friends/group members when
the upload completes. If this stage is interrupted, Resume finishes sharing
without another upload fee. Later eligible members can request access. Removing
a friend or group member prevents new delivery and the client rechecks membership
when opening protected audio. Already delivered keys, decrypted audio and comments
can be retained or redistributed; this is access distribution, not DRM.

## Paid unlocks and refunds

1. The buyer submits `request_music_access` with the exact immutable OSAT price.
   Publications checks the signature, completed track and current audience.
2. The configured OSAT contract reserves transferable tokens in escrow. Free
   usage credits cannot be debited. The reservation and access request are atomic.
3. While the uploader's app is open and unlocked, it reads pending requests,
   recovers its track key, and seals it to the encryption public key recorded in
   that request. The uploader can also use **Deliver access** on the track page.
4. `grant_music_access` rechecks eligibility and the 24-hour deadline, publishes
   the sealed key and releases escrow to the uploader in one transaction.
5. The buyer verifies the sealed key against the committed key hash, verifies all
   audio chunks and the complete ciphertext digest, then decrypts locally.
6. If delivery has not occurred after 24 hours, the buyer can refund. Loss of
   audience eligibility also permits an earlier refund. Refunds do not consume
   OSAT usage credits. Settlement, delivery and refund retries cannot pay twice.

Delivery is asynchronous and requires an unlocked uploader client. No always-on
key server was introduced. Expired requests do not settle. The client scans
pending requests with cursors and backs off failed deliveries.

**Trust boundary:** the chain validates the shape and intended recipient/version
of a key delivery, but cannot prove that a sealed key decrypts the promised song.
The client detects a wrong key; the protocol does not automatically refund an
already delivered, invalid key. Purchase only from an uploader you trust. Likewise,
no protocol can stop someone who has decrypted audio from copying it.

## Storage, pricing and compatibility

Audio remains in contract state in 16 KiB chunks. Public/free audio keeps its
original bytes. Encryption adds 16 bytes per file and does not re-encode audio.
The size limit is 10 MiB including encryption; duration is at most one hour.
Supported browser-playable formats are MP3, M4A, Ogg, WAV and WebM.

New uploads use `append_music_batch` with up to sixteen contiguous chunks per
transaction. A fixed manifest holds the commitments; a separate small progress
record changes during upload. Existing v1 records remain readable and migrate
progress lazily when resumed. Already-paid drafts resume without repaying, even
if uploads are paused or the upload rate changes. Old drafts retain the legacy
single-chunk submission path. New saved drafts include encrypted recovery data
and reproduce identical ciphertext from the original file on resume.

| State space | Purpose |
| --- | --- |
| Publications 40–43 | Existing pricing, track manifests, chunk bytes, profile directory |
| Publications 44 | Compact progress |
| Publications 45–46 | Access receipts and pending deliveries |
| Publications 47–48 | Comments and chronological comment directory |
| Publications 49 | Completed group-track directory |
| OSAT token 15 | Music escrow receipts |

The native upload fee is separate from OSAT unlock prices and transaction Mana.
It remains **86.1 KOIN per decimal MB, rounded up to a whole token** (tKOIN on
Harbinger). A native approval/payment/cleanup bundle reserves each upload once;
failed payment creates no reservation. Abandoned upload fees are not refunded.
Changing implementation efficiency does not automatically lower this application
fee. Measure live Mana before changing the rate.

The sponsor only funds uploads paid to its own configured account. Policy v4
allows 266 KiB operation arguments. A batch counts one resource/quota unit per
chunk: the default 2-Mana ceiling remains 2 Mana for an ordinary action and up to
32 Mana for sixteen committed audio chunks. A paid track retains its two attempts
per chunk per UTC day; batching does not multiply that allowance. Mixed bundles,
unpaid tracks, stale indexes, uncommitted data and oversized batches are rejected.
The sponsorship registry's maximum permitted argument policy is 320 KiB.

## Rollout

This release requires **token, publications and sponsorship** contract upgrades,
the sponsor service update, and the frontend. Existing track state is preserved.
Music reads directly from chain state; no indexer database migration is required.
An indexer rebuild/restart with the shared SDK is recommended for recognizing the
new events in its raw event log, but it does not grant audio access.

After the reviewed branch is available on GitHub:

1. In `deploy-testnet`, select the reviewed `codex/music-access-and-batching` branch and network
   `harbinger`, contracts **music**, and first run **dry run**.
2. Inspect that run, then deploy the same revision with dry run disabled. Leave
   **Enable Music at 86.1 tKOIN per MB** unchecked for an already-enabled network
   to preserve its price/recipient settings. The workflow uses existing repository
   secrets; no new private key is required on the VPS or frontend.
3. Pull that revision on the VPS, build services, restart/re-register the sponsor
   using policy version 4, then run the readiness check:

```bash
npm ci
npm run build -w packages/proto -w packages/sdk -w apps/sponsor -w apps/indexer
OSP_SPONSOR_POLICY_VERSION=4 OSP_SPONSOR_MAX_BYTES_PER_OP=272384 OSP_SPONSOR_MAX_OPS_PER_TX=4 OSP_SPONSOR_REGISTER=true pm2 restart osp-sponsor --update-env
pm2 restart osp-indexer
pm2 save
node --import tsx scripts/verify-music.ts --network harbinger
```

4. Install the frontend ZIP into `public_html`, retaining `.htaccess`, `sw.js`,
   `index.html`, and `assets/`. Retain old hashed assets briefly for open tabs.
5. Perform a small Harbinger upload first. Verify public playback, a private
   upload, a paid request from another identity, key delivery, encrypted comments,
   and pause/resume. Verify the expected OSAT balances and native fee recipient.
   Then run the same-file resource comparison before changing upload prices.

CLI deployment, only where the original deployment credentials are already
configured, is equivalent to selecting **music** in the workflow:

```bash
npm run build -w packages/proto -w packages/sdk -w packages/contracts
node --import tsx scripts/deploy-contracts.ts --network harbinger --only token,publications,sponsorship --dry-run
node --import tsx scripts/deploy-contracts.ts --network harbinger --only token,publications,sponsorship
```

Never switch the active publication contract back to v1 after v2 uploads begin:
v1 cannot see the separate progress or access records. Rollback the frontend or
fix forward with compatible contracts. Do not remove the configured token or
publications contract while escrow payments are pending.

## Evidence and remaining live check

See [music-v2-benchmark.md](music-v2-benchmark.md) and
[evidence/music-v2-byte-benchmark.json](evidence/music-v2-byte-benchmark.json).
Contract tests cover escrow authorization and conservation, exactly-once
settlement/refund, delivery deadlines, audience revocation, comment permissions,
legacy progress, replayed batches and immutable commitments. SDK and UI tests
cover encryption integrity, recipient/track binding, exact pricing, resumable
ciphertext, withheld access, pending delivery and encrypted comments.

The v1 [native simulation](evidence/music-native-simulation.json) remains prior
historical evidence; it does not validate v2 escrow or a full v2 song upload.
The completed v1/v2 song comparison is recorded in
[evidence/music-v2-live-benchmark.json](evidence/music-v2-live-benchmark.json).
The v3 transfer benchmark and rollout are in [music-v3-transfers.md](music-v3-transfers.md).
New v3 Mana and live timing measurements remain pending deployment.

## Faster downloads and device cache

Music capability version 3 adds the read-only `get_music_chunks(id, index, count)`
method. It returns at most 16 committed chunks per request and also reads existing
v1/v2 tracks. The frontend runs at most four requests concurrently, validates
every chunk against its manifest, then validates the complete file digest. It
uses the existing single-chunk reads on older contracts. Malformed batch responses
are rejected, not silently accepted or downgraded.

Verified chain bytes are cached in IndexedDB with a 64 MiB total limit, least
recently used eviction and a 30-day inactivity expiry. Public tracks retain their
original bytes; restricted/paid tracks retain ciphertext only. Reading keys and
decrypted private audio are never written to this cache. Each play reads current
track state and checks protected access before decryption, including cache hits.
Cache data is reverified; a corrupt entry is discarded and downloaded again.
Storage failures do not block playback. Clear the cache in **Settings → Network
& endpoints → Downloaded music**.

Upload batch size is capped by contract capability and the fee recipient's sponsor
policy. Saved drafts can continue using smaller batches. The uploader still waits
for confirmation between batches, preserving account nonce ordering and resume
safety. This release adds neither transcoding nor streaming nor content deduplication.
