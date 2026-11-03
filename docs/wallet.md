# Sponsored Wallet

The Wallet menu opens `/wallet`. Users can choose OSAT or native tKOIN on testnet (KOIN on mainnet), copy their receiving address, enter an amount, or choose Send all. A review displays the exact amount, recipient, sending address and network before signing. The Tokens page keeps activity, rewards and recharge details and links to Wallet for transfers.

OSAT is whole-token only and Send all uses the contract's transferable balance, excluding recharging tokens. Its recipient must be registered on Open Social. Native KOIN uses eight decimals. Send all uses the smaller of the signing wallet’s balance and its currently regenerated Mana, because KOIN’s transfer method requires both. Sponsorship covers this transfer but cannot unlock tokens tied to previous Mana use; no extra user KOIN is reserved for the new transaction. A recovered profile may have a different OSAT account and native signing address; the UI displays the selected token's actual address.

Amounts use exact integer arithmetic. Balances, the chain, native contract and recipient eligibility are checked again before signing. A reduced available balance requires another review if it can no longer cover the approved amount; additional incoming or regenerated units never silently increase that amount. The frontend never falls back to self-paid Mana for a Wallet transfer.

The sponsor resolves KOIN through the selected chain's name service. It funds one canonical transfer operation per transaction, binds native transfers to the signing wallet and OSAT transfers to the account or its on-chain owner, and retains ordinary daily/burst/Mana limits. Mixed transfers, arbitrary token contracts, zero amounts and attempts to move another wallet's KOIN are rejected. Music approvals still require their exact existing three-operation payment bundle. Custom `OSP_SPONSOR_ALLOWLIST` settings remain restrictive: the default policy is required for native wallet transfers.

Before broadcasting, the browser saves the signed transfer in encrypted local storage. Unknown outcomes remain pending across reloads and block another Wallet transfer until its canonical block receipt is found. Checking status never resends it. Explicit rejection permits a fresh review. The shared account submission lock protects both submission and recovery-record removal across browser tabs.

## Rollout

No contract upgrade, new seed, token migration or indexer change is required. Merge the Wallet update into `codex/protocol-polls`, then update the existing VPS:

```bash
cd ~/Open-Social-Protocol &&
git fetch origin &&
git switch codex/protocol-polls &&
git pull --ff-only &&
npm ci &&
npm run build -w packages/proto -w packages/sdk -w apps/sponsor
```

After that succeeds:

```bash
OSP_SPONSOR_REGISTER=true pm2 restart osp-sponsor --update-env && pm2 save
node --import tsx scripts/verify-wallet.ts --network harbinger
```

Keep the Music limits already configured on the sponsor. `WALLET READY` requires both the updated signed discovery policy and on-chain sponsor registration; registration can take a short time after restart. If using a custom allowlist, review that operator policy before switching to the default. Do not run the contract deployment workflow for this Wallet update.

Back up Hostinger `public_html`, then extract `OpenSocial-Wallet-Frontend.zip` directly into it, including `.htaccess`, `sw.js`, `index.html` and `assets/`. Keep older hashed assets briefly for cached browser tabs. Refresh, open Wallet, and test a small OSAT transfer and a small tKOIN transfer before Send all. Verify the recipient balances and that the transaction payer is the platform sponsor. This release includes offline transaction, sponsor and UI tests; no live user funds are transferred during development.

Native transfer rules: [Koinos KOIN contract](https://github.com/koinos/koinos-contracts-as/blob/master/contracts/koin/assembly/Koin.ts), `transfer` and `get_account_rc`.

Validation: 526 tests passed across SDK, sponsor and web, with two existing web tests skipped. All three workspaces and deployment scripts type-check; sponsor and production frontend builds and the shipped-bundle smoke test passed. Browser interaction tests cover both tokens, exact Send all, review before send and pending-state recovery. A Chromium visual check could not run because its browser download was unavailable; manual desktop/mobile layout and live transfer checks remain rollout checks.
