# Open Social Protocol

A decentralized, encrypted social layer built on [Koinos](https://koinos.io): identities,
relationships, publications and access permissions are controlled by users, not by a platform
operator. This repository contains the complete reference implementation described in the
project proposal, roadmap, technical plan and whitepaper (`docs/`):

| Product | Location | What it is |
| --- | --- | --- |
| **Protocol** | `packages/proto`, `packages/contracts`, `packages/sdk` | Versioned Protobuf schemas, six AssemblyScript Koinos contracts, TypeScript SDK with encryption, signing, reconciliation and golden vectors |
| **Reference web client** | `apps/web` | Responsive React client: onboarding, key vault, feed, composer, profiles, friends, notifications, settings, recovery. Static build hosted on Hostinger from GitHub |
| **Browser extension** | `apps/extension` | Chrome Manifest V3: key-isolated service worker, side panel feed/composer, generic sidebar, Facebook cross-post adapter with idempotent reconciliation |
| **Infrastructure** | `apps/indexer`, `apps/sponsor`, `scripts/`, `deployments/` | Replayable indexer with query API, Mana sponsor service, testnet deployment tooling |

Core proposition: *your identity, relationships and content should outlive any one application.*

## Status

Testnet pilot implementation (protocol v1, Koinos Harbinger). Cryptography, contract interfaces
and resource figures require independent review before any mainnet use. See
`docs/protocol-spec.md` for the normative rules and `docs/adr/` for design decisions.

## Quick start

```sh
npm install                 # Node 22+
npm run build:all           # schemas -> SDK -> contracts -> indexer -> sponsor -> web -> extension
npm test                    # every workspace's tests (contract tests run in the Koinos mock VM)
```

Run against the Harbinger testnet once `deployments/harbinger.json` exists
(see `docs/deploy-testnet.md`):

```sh
OSP_NETWORK=harbinger npm run indexer     # http://localhost:8787
OSP_NETWORK=harbinger OSP_SPONSOR_WIF=... npm run sponsor   # http://localhost:8788
npm run web                               # http://localhost:5173
```

Load the extension: `npm run build:extension`, then Chrome -> Extensions -> Developer mode ->
Load unpacked -> `apps/extension/dist`.

## Launching on the Koinos testnet

`docs/deploy-testnet.md` explains both paths: the **Deploy contracts to Harbinger** GitHub
Actions workflow (recommended; uses repository secrets, commits `deployments/harbinger.json`)
or `npm run deploy:testnet` locally with a funded tKOIN key.

## Hosting the web client on Hostinger

`docs/hostinger.md`: import this GitHub repository as a Node.js web app with build command
`npm run build` and output directory `apps/web/dist`, or point Hostinger's Git deployment at
the `hostinger-static` branch produced by `.github/workflows/deploy-web.yml`.

## Repository layout

```
packages/proto        schemas (osp/*.proto) + generated descriptors and koilib ABIs
packages/contracts    AssemblyScript contracts: identity, relationships, publications,
                      communities, sponsorship, registry (+ mock-VM unit tests)
packages/sdk          @osp/sdk: ids, canonical encoding, encryption, protocol client,
                      sponsor client, reconciliation state machine, proof manifests, vectors
apps/web              reference client (Vite + React)
apps/extension        Chrome MV3 extension (Vite + @crxjs)
apps/indexer          replayable indexer (node:sqlite + Fastify)
apps/sponsor          Mana sponsor service (Fastify)
scripts               deploy-contracts.ts, verify-deployment.ts, localnet helpers
deployments           <network>.json manifests consumed by clients and services
docs                  spec, ADRs, sponsor API, deployment and hosting guides
```

## Decentralization test

Every non-consensus component here has a documented replacement path: run your own indexer
(`apps/indexer/README.md`), your own sponsor (`docs/sponsor-api.md`), your own client (the SDK
plus golden vectors), or mirror encrypted media (content-addressed). No founding-team service is
required to use the protocol.

## License

MIT. See `LICENSE`.
