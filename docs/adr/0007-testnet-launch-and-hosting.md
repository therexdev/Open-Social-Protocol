# ADR 0007: Testnet launch path and reference-client hosting

Status: accepted (2026-09)

## Context
Contracts must be deployed to the Koinos Harbinger testnet; the reference web client is hosted
on Hostinger from the GitHub repository. Deployment needs a funded tKOIN account whose private
key must never be committed.

## Decision
* `scripts/deploy-contracts.ts` deploys all six contracts with `koilib`. Contract accounts are
  derived deterministically from a deployer-controlled seed (`OSP_CONTRACT_SEED`), the funded
  deployer key pays Mana (payer/payee), dependencies are wired (`set_identity_contract`, ...)
  and the registry is initialised. Results are written to `deployments/<network>.json`.
* A `workflow_dispatch` GitHub Actions workflow (`deploy-testnet.yml`) runs the same script on a
  GitHub runner using repository secrets (`KOINOS_HARBINGER_DEPLOYER_WIF`, `OSP_CONTRACT_SEED`)
  and commits the deployment manifest back to the branch.
* The web client reads `deployments/harbinger.json` at build time and can also be pointed at
  any other network/indexer/sponsor at runtime (Settings), keeping the frontend replaceable.
* Hostinger: import the GitHub repository as a Node.js web app, build command `npm run build`,
  output directory `apps/web/dist`, Node 22. A `deploy-web.yml` workflow additionally publishes
  the built static site to the `hostinger-static` branch for the plain Git/static path.

## Consequences
The launch is reproducible from CI without exposing keys to developer machines, and the client
can be rebuilt and rehosted by anyone.
