# Launching on the Koinos Harbinger testnet

## What gets deployed
Six contracts (`identity`, `relationships`, `publications`, `communities`, `sponsorship`,
`registry`), wired together and recorded in `deployments/harbinger.json`.

## Prerequisites
1. A funded Harbinger account. Request tKOIN in the `#faucet` channel of the official Koinos
   Discord (`!faucet <address>`, 100 tKOIN per request). Deployment of all six contracts needs
   roughly 20-40 Mana at current testnet prices; the deploy script prints the measured RC per
   contract.
2. Node 22 and `npm install` at the repository root.

## Option A - GitHub Actions (recommended; no keys on a developer machine)
1. In the GitHub repository settings add secrets:
   * `KOINOS_HARBINGER_DEPLOYER_WIF` - private key (WIF) of the funded account.
   * `OSP_CONTRACT_SEED` - any long random string; contract addresses derive from it, so keep
     it to redeploy upgrades to the same addresses.
2. Run the **Deploy contracts to Harbinger** workflow (`Actions -> deploy-testnet -> Run workflow`).
3. The workflow builds, deploys, verifies read-only calls against each contract and commits
   `deployments/harbinger.json` back to the branch. The web client and extension builds pick
   it up automatically.

## Option B - local
```sh
export KOINOS_HARBINGER_DEPLOYER_WIF=5K...
export OSP_CONTRACT_SEED="a long random phrase"
npm run deploy:testnet
```
Environment overrides: `KOINOS_RPC=https://harbinger-api.koinos.io,https://api.harbinger.koinos.pro`
(comma-separated failover list), `OSP_UPGRADE_DELAY_MS`, `OSP_SPONSOR_ENDPOINT`.

## After deployment
* Start an indexer: `OSP_NETWORK=harbinger npm run indexer` (reads `deployments/harbinger.json`).
* Start the sponsor: `OSP_SPONSOR_WIF=... OSP_NETWORK=harbinger npm run sponsor`.
* Point the web client / extension at the indexer and sponsor URLs (Settings), or bake them in
  with `VITE_OSP_INDEXER_URL` and `VITE_OSP_SPONSOR_URL` at build time.
* Register the sponsor on chain: the sponsor service does this on first start when
  `OSP_SPONSOR_REGISTER=true`.

## Verifying the launch
`node --import tsx scripts/verify-deployment.ts --network harbinger` performs read-only calls
against every contract, checks the registry entries and prints a summary. The same script runs
at the end of the GitHub workflow.
