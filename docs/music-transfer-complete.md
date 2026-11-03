# Final Music transfer improvements

This release adds four transfer improvements without changing audio, prices,
contracts, track IDs, encryption or upload transaction ordering:

1. The standard SDK provider confirms inclusion using block metadata only. It
   checks the candidate block against the current head's fork, preserving the
   existing unknown-outcome error on failed confirmation. Inclusion still does
   not mean irreversible finality. Custom providers retain their own wait method.
2. A completed upload verifies the fresh on-chain manifest and caches the same
   stored bytes immediately. Restricted tracks cache ciphertext, never keys.
3. Interrupted downloads persist individually verified chunks and resume missing
   chunks after reload. Every restored chunk is rechecked against fresh chain
   metadata. Partial and complete files share the existing 64 MiB LRU browser
   budget and 30-day inactivity expiry. Browser eviction can still require a
   redownload. Clearing the music cache removes partial files as well.
4. The existing indexer can optionally mirror verified chain bytes on disk. The
   frontend requests binary byte ranges, verifies their hashes against fresh
   on-chain metadata and falls back to native RPC reads on any failure. Existing
   access checks still run before decryption. This is full-file loading, not
   early-start streaming.

## Optional server mirror

Enable `OSP_MUSIC_CACHE=true` on `osp-indexer`. `OSP_MUSIC_CACHE_DIR` defaults to
`data/music-cache`; `OSP_MUSIC_CACHE_MAX_MB` defaults to 512 MiB (10–4096 supported).
The cache is namespaced by chain and publications contract, with atomic writes,
LRU eviction and verification of files restored after restart. No SQLite schema
change, reindex, new port or contract deployment is required.

`GET /v1/music/:id/bytes?digest=<base64url SHA-256>` serves full bytes (200) or a
single `Range: bytes=start-end` (206). IDs and digests are canonical padded
base64url 32-byte values. The API advertises `features.musicGateway: 1` while
enabled with a deployment. Its existing HTTPS reverse proxy must forward this
route, the Range header, Content-Range response and CORS headers.

A cold request returns 202 immediately and starts a background fill. The browser
uses the blockchain for that attempt; subsequent listeners use the warmed file.
At most two fills run, each with two native reads in flight; ten new fills may
start per minute. RPC requests abort after 15 seconds per endpoint and fills
have a two-minute budget. Bad files are never published; failed fills have a
one-minute retry cooldown. Disk and browser caches store only original stored
bytes: ciphertext for encrypted tracks. They cannot unlock songs.

Public-chain reads remain eight chunks maximum, with compute-limit reduction to
4/2/1. Uploads retain sixteen chunks where the sponsor/contract allow them. Warm
mirror reads use up to 1 MiB per range with at most four concurrent requests.

## Existing VPS update

From PowerShell:

```powershell
ssh linuxuser@66.42.83.111
```

On Ubuntu, run this build block and continue only when it succeeds:

```bash
cd ~/Open-Social-Protocol &&
git fetch origin &&
git switch codex/music-access-and-batching &&
git pull --ff-only origin codex/music-access-and-batching &&
npm ci &&
npm run build -w packages/proto -w packages/sdk -w apps/sponsor -w apps/indexer
```

```bash
mkdir -p "$HOME/Open-Social-Protocol/data/music-cache" &&
OSP_MUSIC_CACHE=true \
OSP_MUSIC_CACHE_DIR="$HOME/Open-Social-Protocol/data/music-cache" \
OSP_MUSIC_CACHE_MAX_MB=512 \
pm2 restart osp-indexer --update-env &&
pm2 restart osp-sponsor &&
pm2 save
```

```bash
pm2 status
curl -fsS http://127.0.0.1:8787/v1/status | python3 -m json.tool
curl -fsS https://social-api.usekoinos.com/v1/status | python3 -m json.tool
node --import tsx scripts/verify-music.ts --network harbinger
```

Both status responses should advertise `musicGateway: 1`. Music readiness should
still pass at capability 3. Existing sponsor policy 4 stays configured. If a
service fails, inspect `pm2 logs osp-indexer --lines 80 --nostream` or the
corresponding sponsor log. Do not delete the indexer database or re-upload tracks.

Warm/check the existing 10 Second Test:

```bash
curl -sS --max-time 30 -D - -o /dev/null \
  -H 'Range: bytes=0-16383' \
  'https://social-api.usekoinos.com/v1/music/FDXbV8lFS3ohczhKJB7PFDotFyqoBxk72cvrnvfcqAs%3D/bytes?digest=sRnrmW_qWbAcQOJo1PUIMaEQg885PGYyHF66-E5HepE%3D'
```

202 is normal while warming. Repeat after several seconds; expect 206 and
`Content-Range: bytes 0-16383/402381`. A persistent public 404 with a working local
route means the reverse proxy also needs to forward `/v1/music/` to port 8787.

To disable just the optional mirror:

```bash
OSP_MUSIC_CACHE=false pm2 restart osp-indexer --update-env && pm2 save
```

## Hostinger frontend

The release ZIP is a ready-built frontend. `index.html`, `.htaccess`, `sw.js` and
`assets/` are at its root. It contains no keys or server configuration. The server
code is installed by the Git commands above.

1. In hPanel open the **opensocial.online** site's File Manager and `public_html`.
2. Save a backup of the existing site files outside `public_html` or download it.
3. Upload the release ZIP and extract its contents directly into `public_html`,
   overwriting matching files. Do not create a nested release folder. Merge the
   assets directory and keep older hashed assets temporarily for already-open tabs.
4. Confirm `public_html/index.html`, `public_html/.htaccess`, `public_html/sw.js`
   and `public_html/assets/` exist. Remove the uploaded ZIP after extraction.
5. Close all Open Social tabs and installed-app windows, then reopen
   `https://opensocial.online`. On desktop use Ctrl+Shift+R if needed. Do not clear
   browser site storage: it contains local account data and caches.
6. The release uses the existing Harbinger RPC, `social-api.usekoinos.com` indexer
   and `social-sponsor.usekoinos.com` sponsor. A previously customized Settings
   indexer must also point at the updated server to use its mirror.
7. Play existing tracks. For a resume check, interrupt a download before it
   finishes and reload. Cached chunks survive; completed-cache playback still
   makes fresh metadata/access reads. A new successfully confirmed upload should
   play from the same browser's cache without re-fetching audio chunks.

## Validation and practical limits

SDK, indexer and web tests cover canonical-fork confirmation, unknown submission
outcomes, encrypted upload caching, browser eviction, interruption/resume, corrupt
chunks, invalid/oversized mirror responses, RPC fallback, server ranges, restart,
disk eviction and adaptive compute-limit reads. Builds include the frontend's
production module smoke check.

`docs/evidence/music-transfer-complete-live.json` records Chromium using production
loader/IndexedDB code against live Harbinger metadata and chunks, plus the local
mirror filled from that chain. The original 8,403,298-byte file used nine warm
binary requests instead of 65 native chunk reads. The 402,381-byte test used one
binary request. Both decoded and played with exact original SHA-256 digests.
After cancellation, eight chunks survived reload and the full song resumed with
64 native reads; the next reload used zero audio reads. Metadata-only inclusion
also succeeded for an existing live deployment transaction.

These are local mirror results, not a VPS/mobile throughput guarantee. The first
listener may use native RPC while the server warms, and a cache may be evicted.
Upload block times, Mana and the application charge are unchanged by this release.
No new paid transaction was broadcast for validation.
