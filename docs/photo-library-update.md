# Update the running Open Social testnet

This release combines Photos / Albums, selected-account sharing, private groups, the protocol photo archive and the existing friends-first @mention autocomplete. Keep using `codex/protocol-polls` on the VPS after the release is merged. The production mainnet is not targeted.

## 1. Contract deployment

The `photo-library-testnet` workflow upgrades only publications, at its existing address, using the saved testnet deployment secrets. It simulates the upgrade, checks the release runtime, deploys and verifies the photo-library version and usage dependency. Its completed manifest must be merged into `codex/protocol-polls` before updating the VPS.

For a manual retry, start a new `deploy-testnet` workflow run on `codex/protocol-polls`, network `harbinger`, **contracts = publications**, dry run unchecked and force unchecked. Retain the existing seed. A failed run's progress record supports resuming the same deployment; do not create replacement contract accounts.

## 2. Update your VPS

SSH into the same `osp-harbinger` server used for the indexer and sponsor. Run this entire block. It stops on an error and preserves your SQLite databases before migration. No private keys need to be pasted into ChatGPT.

```bash
(
  set -e
  cd ~/Open-Social-Protocol
  git fetch origin
  git switch codex/protocol-polls
  git pull --ff-only origin codex/protocol-polls

  pm2 stop osp-indexer osp-sponsor
  node scripts/backup-photo-library-databases.mjs
  npm ci
  npm run build -w packages/proto -w packages/sdk -w apps/indexer -w apps/sponsor

  OSP_SPONSOR_MAX_BYTES_PER_OP=24576 \
  OSP_SPONSOR_BURST_OPS=180 \
  OSP_SPONSOR_REGISTER=true \
  OSP_MEDIA_PROVIDER= \
    pm2 restart osp-indexer osp-sponsor --update-env
  pm2 save

  node --import tsx scripts/verify-photo-library.ts --network harbinger \
    --indexer http://127.0.0.1:8787 --sponsor http://127.0.0.1:8788
)
```

The migration happens automatically when the updated indexer starts. Do not delete its database or restart indexing from scratch. Backups are stored under `~/osp-backups/photo-library-<timestamp>`, including WAL/SHM companions and a manifest of original paths. The backup helper refuses to run while either service is running and stops if its configured/default database cannot be located. For custom PM2 names or database configuration, use their actual names/paths rather than resetting anything.

If the checker reports that the indexer is catching up, wait briefly and run only the verification command again. Successful output ends in `PHOTO LIBRARY READY`. It checks on-chain photo version, the usage contract, indexer chain and height, the signed sponsor policy and the on-chain sponsor allowlist. It performs no writes.

If it reports a missing sponsor method, preserve your current custom allowlist and add `publications:begin_photo`, `publications:append_photo`, `publications:save_collection` and `publications:set_album_item`, then restart the sponsor with `--update-env`. If registration failed, inspect its logs and check the sponsor's testnet Mana.

For diagnosis:

```bash
pm2 logs osp-indexer --lines 40 --nostream
pm2 logs osp-sponsor --lines 40 --nostream
curl -fsS http://127.0.0.1:8787/v1/status
curl -fsS http://127.0.0.1:8788/healthz
```

If you also maintain these settings in a PM2 ecosystem file or launch script, put the same values there so a later recreation keeps them. The commands preserve the existing wallet/RPC settings. `OSP_MEDIA_PROVIDER=` disables new legacy IPFS uploads; it does not delete old pinned photos or disable gateway reads. The daily sponsor quota stays at 200 operations.

## 3. Upload the frontend

After verification succeeds, extract `OpenSocial-Photos-Groups-Frontend.zip` and upload its **contents** to the same `public_html` directory for `opensocial.online`. `index.html`, `assets/`, `sw.js` and `.htaccess` must be at the website root, not inside an extra folder. Include the hidden `.htaccess` file. Back up the current website first and retain existing hashed assets during the transition so already-open clients can finish loading.

The package uses the current testnet contract addresses and public endpoints. Refresh the browser; if an older version remains open, close all Open Social tabs and reopen the site so the service worker can activate the new bundle.

## 4. Confirm the product flow

- Profile → Photos: upload privately, select a non-friend, and confirm the prepared size/cost before saving. Check both All photos and Albums.
- Create a private album, add the image, add/remove a member, and remove a photo from the album.
- Groups: create a group, add a member, post, then remove the member and verify the current group view is denied.
- Type `@` in a post/reply to confirm that mentions remain available.

The first live upload and membership check should use your own test accounts. Automated tests and release verification do not replace actual multi-account recovery or Mana measurements. Revocation cannot erase earlier copies/keys. New group members receive future posts, while sharing an album includes its existing photos.

See [photo-library.md](photo-library.md) for prices, storage/recovery design and release limitations.
