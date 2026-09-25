# Launching on the Koinos Foundation testnet

The existing `harbinger` configuration name now targets the current Foundation testnet:
`https://testnet.koinosfoundation.org/jsonrpc`, chain ID
`EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==`.
This is a different chain from the legacy Harbinger endpoint. Keep `OSP_NETWORK=harbinger`,
the existing secret names and your saved `OSP_CONTRACT_SEED`; fund your deployer and sponsor
on the current network. Legacy Harbinger balances and deployments do not carry over.
Endpoint and faucet reference: https://github.com/koinos/koinos-testnet.

## What gets deployed
Eight contracts (`identity`, `relationships`, `publications`, `communities`, `sponsorship`,
`registry`, `messaging`, `token`), wired together and recorded in `deployments/harbinger.json`.

## Prerequisites
1. A funded account on the current Foundation testnet. Open
   https://t.me/KoinosTestnetFaucetBot and send `/faucet <public-address>`.
   The faucet currently sends 100 testnet vKOIN per request, with a 24-hour cooldown per
   Telegram user and recipient address. Fund the deployer and sponsor accounts; you can
   transfer part of the faucet grant to the sponsor. Deployment of all eight contracts
   requires measured Mana; the deploy script prints the measured RC per contract.
2. Node 22 and `npm install` at the repository root.

## Option A - GitHub Actions (recommended; no keys on a developer machine)
1. In the GitHub repository settings add secrets:
   * `KOINOS_HARBINGER_DEPLOYER_WIF` - private key (WIF) of the funded account.
   * `OSP_CONTRACT_SEED` - any long random string; contract addresses derive from it, so keep
     it to redeploy upgrades to the same addresses.
2. Run the **deploy-testnet** workflow (`Actions -> deploy-testnet -> Run workflow`),
   selecting the updated source branch, network `harbinger`, and leaving dry run and force
   unchecked. Start a new run after code updates; re-running an old run uses its old commit.
3. The workflow builds, deploys, verifies read-only calls against each contract and commits
   `deployments/harbinger.json` back to the branch. The web client and extension builds pick
   it up automatically.

## Option B - local
```sh
export KOINOS_HARBINGER_DEPLOYER_WIF=5K...
export OSP_CONTRACT_SEED="a long random phrase"
npm run deploy:testnet
```
Environment overrides: `KOINOS_RPC=https://testnet.koinosfoundation.org/jsonrpc`
(or a comma-separated list of endpoints for this same chain), `OSP_UPGRADE_DELAY_MS`.
Remove any old `KOINOS_RPC` repository variable and update any explicit `VITE_OSP_RPC_URLS`
frontend override. The pinned chain ID check deliberately rejects other networks.

## After deployment
* Start an indexer: `OSP_NETWORK=harbinger npm run indexer` (reads `deployments/harbinger.json`).
* Start the sponsor: `OSP_SPONSOR_WIF=... OSP_NETWORK=harbinger npm run sponsor`.
* Point the web client / extension at the indexer and sponsor URLs (Settings), or bake them in
  with `VITE_OSP_INDEXER_URL` and `VITE_OSP_SPONSOR_URL` at build time.
* Register the sponsor on chain: the sponsor service does this on first start when
  `OSP_SPONSOR_REGISTER=true`.

## Mana limits and interrupted deployments
Each upload and configuration transaction is simulated without broadcasting first. The
script then sets its RC limit to the measured cost plus 10% headroom and re-signs it.
This avoids reserving the entire wallet's Mana for every transaction. Definite
`insufficient pending account resources` refusals wait and retry the same signed
transaction for up to five minutes; unknown submission outcomes are not blindly retried.
Confirmed uploads are saved in `deployment-progress/<network>.json`, separate from the
frontend's completed manifest. The workflow preserves that checkpoint even on failure.
Start a new workflow run to load saved progress; the script verifies each recorded upload
on chain before skipping it. Keep the same seed and leave force unchecked.

## Contract runtime compatibility
The contract build targets WebAssembly 1.0 for Koinos's Fizzy runtime. It disables
bulk memory, sign extension, nontrapping float conversion and mutable-global imports
and exports, and checks every compiled artifact before deployment. A successful upload
alone does not prove the bytecode can execute. `unknown section encountered 12` means
an older build included the unsupported bulk-memory data-count section; update the
source and start a new workflow run. Changed bytecode is uploaded to the same contract
addresses automatically, with the same seed and force unchecked.

## Refreshing an existing VPS installation
After the workflow succeeds, pull its completed manifest into the outer repository
directory and rebuild the services before restarting PM2:

```sh
cd ~/Open-Social-Protocol
git pull --ff-only
test -f deployments/harbinger.json
npm ci
npm run build -w packages/proto -w packages/sdk -w apps/indexer -w apps/sponsor
pm2 restart osp-indexer osp-sponsor --update-env
pm2 save
curl http://127.0.0.1:8787/v1/status
curl http://127.0.0.1:8788/healthz
```

The sponsor returns `not_deployed` until it can load that completed manifest. The
indexer should still listen and report its undeployed status; a connection refusal
needs `pm2 logs osp-indexer --lines 40 --nostream` to diagnose. Both services support
PM2 loading their entry points through its launcher.

## Verifying the launch
`node --import tsx scripts/verify-deployment.ts --network harbinger` performs read-only calls
against every contract, checks the registry entries and prints a summary. The same script runs
at the end of the GitHub workflow.
