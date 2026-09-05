# @osp/web - Open Social reference web client

A static single-page application (Vite 8, React 19, TypeScript) that implements the primary
journey of `docs/client-ux-principles.md`: create or import an account, register it on chain,
find friends, publish to **Everyone** or **Friends** (encrypted on the device), read and react,
recover from an identity file, and set up recovery contacts. Everything protocol-related goes
through `@osp/sdk`; reads use the INDEXER API v1 (`apps/indexer`); every write is a Koinos
transaction submitted through the sponsor pool from Settings with self-pay fallback.

The client is one of several interchangeable frontends: nothing here is required to use an
account (see "Replacing pieces" below).

## Run

```sh
npm install                       # once, at the repository root
npm run build -w packages/proto -w packages/sdk
npm run web                       # vite dev server (http://localhost:5173)
npm test -w apps/web              # vitest + jsdom, fully offline
npm run build -w apps/web         # tsc --noEmit + vite build -> apps/web/dist
npm run preview -w apps/web       # serve the production build locally
```

`dist/` contains `index.html`, hashed assets, `favicon.svg` and `.htaccess` (SPA rewrite for
Apache / LiteSpeed so `/post/<id>` and `/u/<account>` survive a reload).

## Configuration

Build-time defaults (Vite env variables, all optional):

| Variable | Meaning | Default |
| --- | --- | --- |
| `VITE_OSP_NETWORK` | network whose `deployments/<network>.json` is used | `harbinger` |
| `VITE_OSP_RPC_URLS` | comma-separated Koinos RPC endpoints (failover order) | deployment `rpc`, else the SDK preset |
| `VITE_OSP_INDEXER_URL` | INDEXER API v1 base URL | deployment `indexers[0]`, else none |
| `VITE_OSP_SPONSOR_URL` | comma-separated sponsor base URLs | deployment `sponsors` |

Deployment manifests are discovered at build time with `import.meta.glob("../../../deployments/*.json")`.
When no manifest exists for the selected network (for example before the **deploy-testnet**
workflow has produced `deployments/harbinger.json`) the client still builds and runs: a persistent
banner says *"Protocol contracts are not deployed on `<network>` yet - see docs/deploy-testnet.md"*,
on-chain actions are disabled, and creating, exporting and importing accounts and changing
Settings keep working.

Runtime overrides live in **Settings** and are stored in `localStorage` (never secrets): network,
RPC list, indexer URL, sponsor list, payment preference (sponsors first / sponsors only / always
self-pay), auto-lock delay and muted accounts.

## Hosting on Hostinger (or any static host)

See `docs/hostinger.md`. With Hostinger's GitHub import:

* Root directory: repository root (leave empty; the workspace packages must be built first)
* Build command: `npm run build` (builds `@osp/proto`, `@osp/sdk` and this app)
* Output directory: `apps/web/dist`
* Node version: 22
* Optional environment variables: the `VITE_OSP_*` variables above.

The `.htaccess` in `public/` is copied into `dist/`, so deep links work on Apache/LiteSpeed.

## What the client stores on the device

* **Vault** (IndexedDB): the identity seed encrypted under the passphrase with the SDK vault
  format (scrypt + XChaCha20-Poly1305). Unlocked secrets exist only in memory and are dropped on
  lock or after the auto-lock delay.
* **Passkey unlock** (optional, when WebAuthn PRF is available): a second copy of the vault
  locked under a random secret that is wrapped by the passkey's PRF output. The passphrase always
  keeps working.
* **Epoch keys and drafts** (IndexedDB): encrypted with AES-GCM under a key derived from the seed,
  so nothing readable is written to disk. Only *trusted* epoch keys are persisted: keys generated
  on this device, and sealed keys from `/v1/keys/:me` whose `distribute_keys` transaction was
  found on chain with a `keys_distributed` event by the author containing that very sealed key
  (`src/api/keyProvenance.ts`). Anything the chain cannot confirm stays in memory, is used for
  reading only and is never reused to encrypt new posts; Settings offers "Forget cached reading
  keys". Each trusted key records which friends hold a copy, so the composer hands the current
  key to friends who joined later (accepting a request does the same in one transaction).
  Drafts keep their attempt id so a retry reuses the same idempotency key and never creates a
  duplicate post; the record is written *before* the transaction is signed (state `submitting`)
  and the chain is asked for an existing post before any retry (spec section 7).
* `localStorage`: settings, the "seen" notification cursor, ignored friend requests. No plaintext
  posts, keys or seeds.

## Layout

```
src/config.ts          deployment discovery + VITE_OSP_* defaults
src/stores/            settings (persisted), toasts, profiles cache, registration state
src/api/               IndexerClient (every v1 route), ProtocolClient factory, KeyStore, decrypt pipeline, profile documents
src/vault/             vault store (lock/unlock/auto-lock/export/import), IndexedDB storage, encrypted cache, passkey adapter
src/tx/submit.ts       client.submit wrapper: sponsor pool + self-pay preference, toasts, sponsor refusal wording
src/features/          onboarding, feed, composer (plan builder + drafts), post, profile, friends, notifications, settings, recovery
src/components/        layout, toasts, small accessible UI primitives (dialog, fields, tabs)
src/testing/           offline fixtures: synthetic Deployment, fake koilib provider, fake indexer fetch
```

## Replacing pieces

* **Indexer**: run `apps/indexer` against the same deployment manifest and enter its URL in
  Settings (or build with `VITE_OSP_INDEXER_URL`). The client only needs the INDEXER API v1.
* **Sponsor**: run `apps/sponsor` (or any service that implements `docs/sponsor-api.md`) and add
  its URL in Settings. Sponsors are tried in order; when all refuse the account pays itself unless
  Settings says "Sponsors only", in which case the action is refused with an explanation (also
  when no sponsor is configured at all).
* **RPC**: any Koinos node for the selected network.
* **Client**: export the identity file from Settings and import it into another conforming client
  (for example the browser extension in `apps/extension`) or into this client on another device.

## Tests

`npm test -w apps/web` runs vitest in jsdom without network access:

* `src/vault/store.test.ts` - create / lock / unlock / auto-lock / export / import / passkey
* `src/stores/settings.test.ts` - persistence, defaults, deployment selection and the not-deployed state
* `src/api/decrypt.test.ts` - friends-only PostView decrypts for a sealed-key recipient and shows a no-key state otherwise; indexer keys stay untrusted until the chain confirms them, poisoned caches recover
* `src/api/keyProvenance.test.ts` - a sealed key is verified only against a `keys_distributed` event by the author in the named transaction
* `src/features/composer/publish.test.ts` - `[distribute_keys, publish]` operations for a friends-only post, key reuse with distribution to friends who lack it, chain-authoritative recipients, edits, idempotency lookup
* `src/features/composer/usePublish.test.ts` - the attempt record is persisted before submitting; keys and recipients are remembered afterwards
* `src/features/friends/actions.test.ts` - accepting a request hands over the current reading key in the same transaction
* `src/tx/submit.test.ts` - "sponsors only" never falls back to self-pay
* `src/App.test.tsx` - routing smoke render (onboarding, settings, unlock, composer, deep links, registration banner, locked friends feed)
