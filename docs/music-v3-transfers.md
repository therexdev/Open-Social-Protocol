# Music v3 transfers — November 3, 2026

This update preserves the exact audio and current 724 tKOIN application charge
for the 8,403,298-byte Good Vibes test file. It adds 16-chunk uploads, batched
reads of existing and new tracks, and a bounded browser cache. It does not add
streaming, lossy encoding, compression, or deduplication.

| Transfer | Music v2 client | Music v3 client |
| --- | ---: | ---: |
| Full-song upload transactions, including payment | 130 | 34 |
| Audio read requests on first download | 513 | 33 |
| Audio read requests on a verified cache hit | 513 | 0 |

Metadata and access checks still use network reads on cache hits. The table is
verified by local integration tests and wire encoding, not a claim about live
upload/download duration. No v3 Mana saving is claimed before a live benchmark.

## Batch choice

The same-file wire benchmark compared 4, 8 and 16 chunks. They require 130, 66
and 34 upload transactions respectively. A full 16-chunk operation is at most
262,272 bytes for the benchmark; its read response is 262,208 bytes. The new
sponsor limit is 272,384 bytes per operation, the publications system buffer is
327,680 bytes, and the sponsor JSON request body limit is 524,288 bytes. The
current Harbinger block disk budget is 524,288 bytes and network budget is
1,048,576 bytes; 16 chunks leave space for protocol overhead. Actual compute and
Mana still require simulation/live measurement on the target chain.

Sixteen is the supported maximum and default on capability v3. The client caps
uploads to 8/4/1 if the selected fee recipient's sponsor limits or current
contract require it. It retains serial transaction confirmation and checks
every commitment. Existing 1/4-chunk saved drafts remain resumable without
another payment. There is no change to encryption or the 10 MiB file limit.

## Rollout on the current Harbinger deployment

1. Open the repository's **deploy-testnet** GitHub Actions workflow. Choose branch
   `codex/music-access-and-batching`, network `harbinger`, contracts `music`.
   Run with **dry_run checked** first; then start a new run with it unchecked.
   Leave **force** and **activate_music** unchecked. Existing repository secrets
   supply the same contract identities. The publications and sponsorship registry
   upgrades are required; the unchanged token implementation is preserved.
2. On the existing VPS:

   ```bash
   cd ~/Open-Social-Protocol &&
   git fetch origin &&
   git switch codex/music-access-and-batching &&
   git pull --ff-only origin codex/music-access-and-batching &&
   npm ci &&
   npm run build -w packages/proto -w packages/sdk -w apps/sponsor -w apps/indexer
   ```

   ```bash
   OSP_SPONSOR_POLICY_VERSION=4 OSP_SPONSOR_MAX_BYTES_PER_OP=272384 OSP_SPONSOR_MAX_OPS_PER_TX=4 OSP_SPONSOR_REGISTER=true pm2 restart osp-sponsor --update-env
   pm2 restart osp-indexer
   pm2 save
   node --import tsx scripts/verify-music.ts --network harbinger
   ```

   The readiness check must show Music version 3 and pass policy v4 registration.
   Update contracts before sponsor registration so the larger policy is accepted.
3. Upload the contents of the release ZIP's `frontend/` directory into Hostinger
   `public_html`, including `.htaccess`. Keep old hashed assets briefly for open
   tabs. Reload the website. No new upload is needed to accelerate existing tracks.
4. Play an existing public song, reload and play it again to exercise persistence.
   Check an existing protected song using an eligible account. A small new upload
   can then confirm live 16-chunk sponsorship before repeating the full benchmark.

Upload price is unchanged. Existing track IDs, bytes, comments, OSAT access and
paid reservations are preserved. Frontend rollback to the previous release can
read these tracks; never deploy the original v1 contract over v2/v3 state.

## Reproduce the benchmark

Local validation passed: SDK 124 tests, sponsor 74, web 378 (two existing skips),
publications 131, and sponsorship registry 43. The complete workspace build and
frontend/extension smoke checks passed. Tests cover maximum-size signed HTTP
requests, 16-chunk contract buffers, legacy reads, interrupted upload resume,
sponsor capability fallback, corrupt data, cache eviction and restricted access.

A real Chromium check with the original 210-second MP3 confirmed 33 first-load
reads and zero audio reads after a page reload. Encrypted playback also retained
the exact audio, persisted only ciphertext and refused a revoked recipient.
These browser checks used mock chain responses, not deployed v3 contracts. See
[browser evidence](evidence/music-v3-browser-check.json).

```bash
node --import tsx scripts/benchmark-music.ts --audio /path/to/song.mp3 --output results.json
```

For an optional non-broadcast resource comparison, keep the previously deployed
v2 WASM and use an already configured, funded Harbinger test payer:

```bash
node --import tsx scripts/benchmark-music.ts --audio /path/to/song.mp3 --simulate --baseline-wasm /path/to/music-v2.wasm --baseline-batch 4 --output resource-results.json
```

The script asserts Harbinger and uses `broadcast=false` for all variants. Subtract
each variant's zero-chunk control from its 16-chunk result. Multi-operation
simulations do not measure per-transaction network/signing latency; a subsequent
full upload is still needed for final timing and total Mana.

See [byte evidence](evidence/music-v3-byte-benchmark.json) and the prior
[v1/v2 live receipt comparison](evidence/music-v2-live-benchmark.json).
