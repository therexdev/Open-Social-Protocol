# Social media update for Harbinger

Build this release from `codex/social-media-revisions`, based on the deployed Music gallery branch. Use the existing contract accounts, service URLs and databases. Publish the frontend last.

## 1. Upgrade Publications and Token

In the repository's **Actions → deploy-testnet → Run workflow**, select the release branch. Run **harbinger**, **social-media**, **dry_run = true**, **force = false**, **activate_music = false**. After the simulation succeeds, run again with **dry_run = false**. Wait for verification and the deployment-manifest commit. The target upgrades Publications and Token in place. It uses the existing repository secrets. The previous Music rollout must already have the Music recipient enabled and the song flat fee set to 100 tKOIN.

An authenticated GitHub CLI can dispatch the same simulation from any machine:

```sh
gh workflow run deploy-testnet.yml -R therexdev/Open-Social-Protocol \
  --ref codex/social-media-revisions -f network=harbinger -f contracts=social-media \
  -f dry_run=true -f force=false -f activate_music=false
```

## 2. Update the indexer and Mana sponsor

On the Harbinger server, build both services after the workflow completes:

```sh
cd ~/Open-Social-Protocol &&
git fetch origin &&
git switch codex/social-media-revisions &&
git pull --ff-only origin codex/social-media-revisions &&
npm ci &&
npm run build -w packages/proto -w packages/sdk -w apps/indexer -w apps/sponsor
```

After a successful build, back up the current SQLite databases:

```sh
pm2 stop osp-indexer osp-sponsor &&
node scripts/backup-photo-library-databases.mjs
```

If the backup fails, restart both services with `pm2 restart osp-indexer osp-sponsor` and resolve the backup error. After a successful backup, run:

```sh
mkdir -p "$HOME/Open-Social-Protocol/data/music-cache" &&
OSP_SPONSOR_POLICY_VERSION=5 OSP_SPONSOR_MAX_BYTES_PER_OP=272384 \
OSP_SPONSOR_MAX_OPS_PER_TX=4 OSP_SPONSOR_REGISTER=true \
  pm2 restart osp-sponsor --update-env &&
OSP_MUSIC_CACHE=true OSP_MUSIC_CACHE_DIR="$HOME/Open-Social-Protocol/data/music-cache" \
OSP_MUSIC_CACHE_MAX_MB=512 pm2 restart osp-indexer --update-env &&
pm2 save
```

The indexer serves filtered profile videos and song engagement. The sponsor recognizes usage-only voice reservations, validates the exact video fee, and sponsors verified chunk uploads. The existing music mirror can cache clip ciphertext. Both services reuse their existing databases. After startup, check all three layers:

```sh
node --import tsx scripts/verify-music.ts --network harbinger --gallery --clips
```

Wait for **SOCIAL MEDIA READY** before uploading the frontend. For service errors, use `pm2 logs osp-sponsor --lines 60 --nostream` and `pm2 logs osp-indexer --lines 60 --nostream`.

## 3. Publish the frontend

In Hostinger, back up `public_html` and extract `OpenSocial-Voice-Video-Revisions.zip` into it. The ZIP has `index.html`, `.htaccess`, `sw.js`, `assets/`, and `release.json` at its root. Keep the existing hashed assets so active sessions can finish. Open `https://opensocial.online/release.json?v=social-media-revisions` and confirm the release field reads `2026-11-04-social-media-revisions`. Close and reopen installed PWAs. Keep site storage intact: it holds account and device keys and queued transfers.

## Harbinger acceptance check

1. Edit an ordinary post from the feed. Open **Edited** and compare the old and current content. The URL, thread and reaction target stay tied to the original publication. Poll questions/options remain immutable after voting opens. Under the existing OSAT policy, editing a version with an unsettled reward closes voting and settles that reward at zero.
2. Record a voice post and a voice comment. Test a selected-account post with two accounts, one included and one excluded. Switch reactions on the same post. A replacement counts once. Votes use the existing public-post eligibility and OSAT weight rules.
3. Send a voice DM and play it from the recipient's account. Link a second browser from **Message settings**. Its access to past messages follows the history option chosen when linking. Third-party clients also need support for voice attachments to play them.
4. Upload a 10–30 second MP4 or WebM. Review the 100 tKOIN charge, publish, then play it from the profile Videos tab. Retry an interrupted upload using its saved draft. The reservation is idempotent, and the original receipt and chunk commitments are reused.
5. Change a profile picture and banner. Check another account's phone-width profile and the comment bylines on an older song.

Voice uses one standard storage usage unit per started 32 KiB of stored audio, up to two minutes and 1 MiB per recording. The enclosing post, comment or DM still uses the usual social allowance. Videos are limited to 10 MiB stored and charge a flat 100 tKOIN for a new reservation. Browser uploads preserve the original encoded file. When gzip saves at least one 16 KiB transfer chunk, the browser stores the losslessly compressed bytes and restores them for playback. Camera capture performs the initial browser encoding. Network speed depends on the clip and chain conditions.

Public, Friends, Group, and selected-account posts use the existing post access system. A DM carries its audio key in its encrypted conversation, and a voice comment on a restricted or paid song carries its key in the encrypted comment. Public archive metadata includes the uploading account, time, MIME type, declared duration, and ciphertext size. The browser checks actual upload duration. The contract validates declared duration and byte limits, including for encrypted clips.
