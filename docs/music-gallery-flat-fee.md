# Music gallery, artwork, feed and flat upload fee

Music now has persistent Tiles/List views with cover art, artist details, audience
and price badges, playback, and links to each track's comments. The post composer
has a bordered content editor and a photo/poll toolbar below it; the two requested
prompts are removed while mention completion and polls remain available.

## Pricing and compatibility

The Harbinger activation workflow sets `flat_fee: "10000000000"`: exactly 100 tKOIN
per new song reservation, for any supported audio size (up to 10 MiB, including
encryption). The native fee still reaches the configured music recipient. Mana
is separate. Existing paid reservations retain their original payment and resume
without being charged again; previous payments are not retroactively refunded.

The config keeps transfer capability `version: 3`. A separate
`get_music_art_version({}).version === 1` advertises cover/flat-fee support.
The SDK, sponsor and frontend honor nonzero `flat_fee`; zero preserves legacy
per-MB pricing. `configure-music.ts` defaults to 100 native tokens; `--flat-fee 0`
explicitly restores the legacy per-MB policy. Only contract authority can change
pricing. No token or sponsorship contract upgrade is required from Music v3.

## On-chain artwork and access

Artwork uses the existing photo archive: commitments in state, image chunks in
chain events. The UI prepares a JPEG capped at 128 KiB including encryption.
It consumes the usual photo usage allowance, separate from the song's tKOIN fee.
Audio is never transcoded or recompressed.

Public covers are previews, including covers for public paid tracks. Friends and
group covers use the track key with a fresh nonce and a separate authenticated
encryption context. Caches store ciphertext for restricted covers, never the key
or decrypted image. Eligibility is checked before reading those cached bytes.

New uploads save the image ID, commitment, ciphertext and nonce in the encrypted
resumable music draft before any payment. Existing songs have an owner-only
artwork editor, with an encrypted resumable draft. Contract updates require a
completed archive owned by the uploader, a matching size/digest, and the correct
encryption policy. Revision checks reject stale competing edits; confirmed retries
are idempotent. Audio bytes, licenses, title and original payment are unchanged.

Paid access delivery and 24-hour refunds are unchanged. Creators still need Open
Social open and unlocked to deliver keys; this release adds no custody provider.
On-chain metadata such as titles/artists/descriptions is public. The UI filters
restricted discovery, while encryption protects the audio and restricted artwork.

## Feed and server migration

`GET /v2/feed` interleaves normal posts with completed-track references in completion
order. `/v1/feed` is unchanged. Only current eligible friends/group members see
restricted references; both block directions and group closure are respected.
Public paid tracks remain discoverable previews. The browser reads canonical track
metadata and checks current chain eligibility before rendering references, and
rechecks on focus/every 30 seconds. Cover edits do not bump feed order.

SQLite migration 7 adds a music projection. Startup automatically backfills it
from the retained event log in bounded batches. Replays/rollbacks include it.
Do not delete the database or re-upload old tracks. The frontend falls back to
normal posts if an older server returns 404 for `/v2/feed`.

## Deploy to the existing Harbinger installation

1. Open GitHub Actions → `deploy-testnet` in `therexdev/Open-Social-Protocol`.
   Select branch `codex/music-access-and-batching`, network `harbinger`, contracts
   `publications`, `dry_run=true`, `force=false`, `activate_music=false`. Run and
   wait for success. This uses the existing repository secrets; retain them.
2. Run the same workflow with `dry_run=false`, `force=false`,
   `activate_music=true`. This upgrades publications in place and activates flat
   100 tKOIN pricing. Wait for the entire workflow, including activation, to pass.
3. In PowerShell: `ssh linuxuser@66.42.83.111`. On Ubuntu:

```bash
cd ~/Open-Social-Protocol &&
git fetch origin &&
git switch codex/music-access-and-batching &&
git pull --ff-only origin codex/music-access-and-batching &&
npm ci &&
npm run build -w packages/proto -w packages/sdk -w apps/sponsor -w apps/indexer
```

Continue only after a successful build. Back up SQLite before its automatic migration:

```bash
pm2 stop osp-indexer osp-sponsor &&
node scripts/backup-photo-library-databases.mjs
```

If the backup fails, run `pm2 restart osp-indexer osp-sponsor`, and resolve that
error before migrating. Do not delete either database. After backup success:

```bash
mkdir -p "$HOME/Open-Social-Protocol/data/music-cache" &&
OSP_SPONSOR_POLICY_VERSION=5 \
OSP_SPONSOR_MAX_BYTES_PER_OP=272384 \
OSP_SPONSOR_MAX_OPS_PER_TX=4 \
OSP_SPONSOR_REGISTER=true \
pm2 restart osp-sponsor --update-env &&
OSP_MUSIC_CACHE=true \
OSP_MUSIC_CACHE_DIR="$HOME/Open-Social-Protocol/data/music-cache" \
OSP_MUSIC_CACHE_MAX_MB=512 \
pm2 restart osp-indexer --update-env &&
pm2 save
```

Give startup/registration time to finish, then verify:

```bash
pm2 status
node --import tsx scripts/verify-music.ts --network harbinger --gallery
curl -fsS https://social-api.usekoinos.com/v1/status | python3 -m json.tool
curl -fsS 'https://social-api.usekoinos.com/v2/feed?scope=public&limit=5' | python3 -m json.tool
```

Expect `MUSIC READY`, `flat_fee: "10000000000"`, `musicFeed: 1`, and `musicGateway: 1`.
The verifier also checks artwork capability, sponsor policy/registration version 5
and the new cover update entry point. If readiness fails, inspect:

```bash
pm2 logs osp-sponsor --lines 80 --nostream
pm2 logs osp-indexer --lines 80 --nostream
```

If the public v2 feed returns 404 but `http://127.0.0.1:8787/v2/feed?scope=public&limit=5`
works, the existing reverse proxy must forward `/v2/` to port 8787 too. Do not
change the sponsor upstream. Existing mirror routes and CORS settings stay in use.

4. In Hostinger File Manager, back up the current `public_html` contents. Upload
   and extract `OpenSocial-Music-Gallery-100-tKOIN.zip` directly into `public_html`,
   replacing matching files. `index.html`, `.htaccess`, `assets/`, and `release.json`
   must be directly inside `public_html`, not inside another folder. Keep older
   hashed assets until existing browser sessions have refreshed.
5. Open `https://opensocial.online/release.json?v=music-gallery-100`. Expect
   `release: "2026-11-04-music-gallery-flat100"`. Reload the app; if it is installed
   as a PWA, close and reopen it. Do not clear site storage: it contains local
   accounts and resumable uploads.
6. Confirm Tiles/List persists after reload. Add artwork to an existing song
   (photo usage only), verify it appears in the public feed, and open its comments.
   Select a new test audio file and confirm the fee says **100 tKOIN** before paying.
   Test friends/group visibility with a second eligible and an ineligible account.

## Validation

- SDK: 129 passed; indexer: 76 passed; sponsor: 74 passed.
- Web: 401 passed, 2 existing skips; scripts and app TypeScript builds passed.
- Publications contract: 137/137. All eight release WASMs built; runtime bootstrap
  smoke passed (62 successful calls).
- Chromium: desktop tiles, mobile persisted list, composer/polls, feed, audio upload
  quote/art picker and existing-cover editor. No page errors or horizontal overflow;
  actual MP3 playback and artwork hash verification passed against in-memory fixtures.
- New on-chain deployment and paid upload are not claimed as live-tested: perform
  the rollout and smoke checks above. Existing transfer batching/cache behavior is retained.
