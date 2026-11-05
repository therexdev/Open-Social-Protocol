# Automatic OSAT rewards on Harbinger

Eligible author rewards are credited on chain after their voting period closes. Authors can close the browser or stay signed out. The existing Mana sponsor checks the indexer's queue of matured rewards, verifies each against the Token contract and pays the transaction Mana using its existing key. Other self-paying operators can also settle an eligible reward. The contract always pays the recorded author and only settles each reward once.

The indexer includes earlier unsettled rewards, including songs and song comments. After a restart the sponsor picks up the queue again. A busy queue, a lagging indexer or low sponsor Mana can delay settlement. The header links to Tokens and displays the confirmed account balance. On Harbinger, the header shows the USD total for that balance using a fixed rate of $0.17 per OSAT. For example, 100 OSAT displays as **Total: $17.00**.

## 1. Upgrade Token

From **GitHub Actions → deploy-testnet → Run workflow**, use branch `codex/social-media-revisions`, network `harbinger` and contracts `token`. Set `dry_run=true`, `force=false` and `activate_music=false`. After a successful simulation, run again with only `dry_run=false`. Wait for the contract checks and deployment-manifest commit.

## 2. Update the existing services

On the Harbinger box, build before stopping the services.

```sh
cd ~/Open-Social-Protocol &&
git fetch origin &&
git switch codex/social-media-revisions &&
git pull --ff-only origin codex/social-media-revisions &&
npm ci &&
npm run build -w packages/proto -w packages/sdk -w apps/indexer -w apps/sponsor
```

Back up the two PM2 databases with the existing backup helper. If it fails, restart both services and resolve the backup error before continuing.

```sh
pm2 stop osp-indexer osp-sponsor &&
node scripts/backup-photo-library-databases.mjs
```

After a successful backup, restart the updated indexer and sponsor. The indexer adds an index to its existing reward table. The worker shares the sponsor's existing transaction queue and checks the local indexer. These commands assume the usual PM2 names and local indexer port 8787.

```sh
pm2 restart osp-indexer &&
OSP_AUTO_SETTLE_REWARDS=true OSP_REWARD_INDEXER_URL=http://127.0.0.1:8787 \
  pm2 restart osp-sponsor --update-env &&
pm2 save &&
node --import tsx scripts/verify-automatic-rewards.ts --network harbinger
```

Wait for **AUTOMATIC OSAT READY**. A queue with zero eligible items is healthy. For a remote indexer or sponsor, supply the verifier's `--indexer` and `--sponsor` URLs. For a delayed payout, inspect `rewardSettlement` at the sponsor's `/healthz`; it reports the latest check, last confirmed settlement since startup and any error. To pause the worker, restart the sponsor with `OSP_AUTO_SETTLE_REWARDS=false` and `--update-env`. Pending rewards remain discoverable.

## 3. Publish the frontend

Back up Hostinger's `public_html` and extract **OpenSocial-Automatic-OSAT.zip** directly into it. Keep the previous hashed assets for existing browser sessions. Visit `https://opensocial.online/release.json?v=osat-total` and confirm the release is `2026-11-04-osat-total`. For an unpacked browser extension, extract **OpenSocial-Automatic-OSAT-Extension.zip** over its current folder and choose **Reload** in the browser's extensions screen.
