# Profile Music and native upload fees

Personal profiles have a **Music** tab with public tracks, verified playback, an upload quote, progress, pause, and resume. The initial rate is **86.1 native KOIN per decimal MB, rounded up to a whole KOIN**. Harbinger labels the payment **tKOIN**. Administrators can change the rate and size limit without rebuilding the frontend.

| File                   |      Bytes | Initial upload fee |
| ---------------------- | ---------: | -----------------: |
| 3:30 MP3 at 192 kbps   |  5,041,885 |   435 KOIN / tKOIN |
| 3:30 MP3 at 320 kbps   |  8,403,113 |   724 KOIN / tKOIN |
| Maximum supported file | 10,485,760 |   903 KOIN / tKOIN |

These are application prices based on the earlier audio benchmark, **not exact Mana predictions**. The earlier 192 kbps standalone-contract test consumed 439.34 Mana. Its projected 320 kbps data-upload cost was about 724 Mana. The new shared contract has different metadata, transaction batching and execution overhead, and resource prices change. Duration is displayed, but byte size determines the fee. The fee is spent native tokens, separate from regenerative transaction Mana; existing payment preferences still control the transaction payer.

## Storage and payment

Audio bytes are stored in publications contract state, in 16 KiB chunks. This differs from the history-backed photo path: audio playback and profile listing read the contract directly and do not need an indexer database migration. Full public files, titles, owners, fees and chunk commitments are publicly readable. Up to 10 MiB and one hour are supported. The browser validates playable audio before charging and verifies every downloaded chunk and the complete file hash before making an audio URL. The contract enforces byte commitments and metadata bounds, not the semantic truth of a declared audio format or duration.

Storage spaces 40–43 contain the music policy, immutable upload records, chunk bytes, and completed-track directory. Completion adds the track to its owner's paginated directory. There is no automatic post or OSAT charge. Existing photo, group, poll and messaging paths are unchanged.

The payment is one signed, atomic transaction: native KOIN approval for exactly the quote, `begin_music`, and approval cleanup to zero. The deployed KOIN contract requires this allowance for a nested transfer. `begin_music` independently requires publish authority and payer authority, resolves native KOIN through the chain's name service, checks the configuration revision and exact quote, and transfers the fee to the configured recipient. Failed payment creates no reservation. Identical reservation retries never transfer again; changed commitments are rejected. Cleanup also prevents a retry from leaving an allowance behind. No unlimited allowance or payment based on an external transaction-id claim is accepted.

The browser saves an encrypted reservation before signing. Reloading, locking, or navigating away pauses uploads. Select the original file and resume; the client reads on-chain progress and skips completed chunks. Network errors and unknown transaction outcomes retain the reservation. New quotes do not change an already paid reservation, and pausing new uploads does not block paid resumptions. Abandoned reservations are not refunded. Forgetting a saved reservation only removes that device's recovery record; it does not delete public bytes or refund a payment.

The fee recipient should be the existing Mana sponsor. That sponsor only covers music paid to its own address. Exact approval/payment/cleanup bundles are the only native approvals it accepts. A verified paid archive gets its own bounded quota of two attempts per chunk per UTC day; ordinary social actions retain their original quota. Stale, corrupted, unpaid, mixed, or already completed chunk requests are refused. Per-operation Mana limits and burst limits still apply. Uploads can pause if the sponsor's available Mana runs low.

## Rollout

This change is not activated just by replacing frontend files. Keep a backup of the current frontend and deploy the publications and sponsor updates first.

1. Merge this branch into the active `codex/protocol-polls` branch. Start a new run of the existing `deploy-testnet` workflow on that branch, with network `harbinger`, contracts `publications`, dry run and force unchecked, and **Enable Music at 86.1 tKOIN per MB, paid to the current Mana sponsor** checked. No other contract upgrade is needed.
2. The workflow upgrades and verifies the contract, saves the deployment manifest, then activates Music with the existing GitHub Secrets `OSP_CONTRACT_SEED` and `KOINOS_HARBINGER_DEPLOYER_WIF`. No local copy or replacement seed is needed. Activation checks that the seed derives the existing publications address and verifies the current sponsor's signed discovery document before using its address as the fee recipient. The rate is 86.1 tKOIN per decimal MB, rounded up to whole tokens (724 tKOIN for the 8,403,113-byte benchmark), with a 10 MiB file limit. Dry runs never activate Music. The activation checkbox defaults off for later unrelated deployments; selecting it again explicitly restores this policy, and an already matching policy sends no transaction.
3. Rebuild/restart the sponsor from this revision with on-chain registration enabled, then run the readiness check. There is no indexer migration for Music.
4. Install the frontend ZIP contents directly in Hostinger `public_html`, including `.htaccess`, `sw.js`, `index.html`, and `assets/`. Retain old hashed assets briefly for cached tabs.
5. Make one small paid audio upload, reload and play it, then try the 8.4 MB / 3:30 test. Verify fee recipient balance, pause/resume, and that only one fee was paid. This rollout still needs that broadcast end-to-end check.

The commands below are an optional alternative for operators who already hold the original credentials in their environment. Skip them when using the GitHub workflow above. Do not retrieve or replace GitHub secrets to run these commands. Never put credentials in the frontend or shell history. `--recipient ADDRESS` explicitly selects another treasury; a different treasury requires self-paid uploads or a sponsor at that address.

```bash
npm ci
npm run build -w packages/proto -w packages/sdk
node packages/contracts/scripts/build.mjs release publications
node --import tsx scripts/deploy-contracts.ts --network harbinger --only publications --dry-run
node --import tsx scripts/deploy-contracts.ts --network harbinger --only publications
node --import tsx scripts/configure-music.ts --network harbinger
node --import tsx scripts/configure-music.ts --network harbinger --execute
```

On the existing VPS, after pulling the merged revision:

```bash
npm ci
npm run build -w packages/proto -w packages/sdk -w apps/sponsor
OSP_SPONSOR_MAX_BYTES_PER_OP=24576 OSP_SPONSOR_MAX_OPS_PER_TX=4 OSP_SPONSOR_REGISTER=true pm2 restart osp-sponsor --update-env
pm2 save
node --import tsx scripts/verify-music.ts --network harbinger
```

Change the approximate rate with `configure-music.ts --rate-per-mb 86.1 --execute`. Use `--pause --execute` to stop new paid reservations while allowing existing uploads to finish. Readiness fails if Music is paused or the sponsor has not loaded the new payment policy. Restart the sponsor after upgrading the contract; its startup resolves native KOIN and registers the narrowly scoped approval entry point.

## Verification

The release includes contract tests for quote boundaries, authority, underpayment, failed native transfers, idempotent payment, paused resumptions, immutable commitments, chunk integrity, ownership and profile listing. SDK/web/sponsor tests cover the exact 8,403,113-byte / 513-chunk case, four concurrent reads, corrupt playback data, interrupted uploads, stale quotes, native approval restrictions, and paid quota isolation.

A Harbinger **non-broadcast simulation** deployed a temporary copy, registered a temporary identity, funded it within the simulation, ran the payment bundle twice, appended/retried audio bytes and read the track/chunk/directory. It emitted exactly one native upload-fee transfer and one `music_paid` event, with allowance cleanup after both attempts. The simulation committed no state or token movement. It is not a live installed frontend test or a new full-track blockchain upload. The earlier standalone 3:30 audio test remains separate evidence.

Validation for this revision: 1,300 tests passed across protocol, SDK, contracts, indexer, sponsor, web, extension and deployment scripts; two existing web tests remain skipped. Production builds and shipped-bundle smoke checks passed after the frontend type-check fix. The largest 640-chunk / 10 MiB manifest fits the 24 KiB sponsor argument and 32 KiB contract buffers. Desktop/mobile browser playback has not been manually tested for this Music UI.

Reproduce the non-broadcast native-token check with a funded testnet wallet in `KOINOS_HARBINGER_DEPLOYER_WIF`:

```bash
node --import tsx scripts/rehearse-music.ts --network harbinger
```

The saved result is [music-native-simulation.json](evidence/music-native-simulation.json).
