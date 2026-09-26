# V1 testing handoff

The V1 implementation includes encrypted direct messaging, the action token,
regenerative usage limits and bidirectional friendship-key rotation. The September 26
product audit verified all eight live contracts and completed the automated product journey.
See [the audit evidence](v1-product-audit.md); the setup below also applies to fresh deployments.

## Before testing on Harbinger

1. Configure `KOINOS_HARBINGER_DEPLOYER_WIF` and `OSP_CONTRACT_SEED` in repository
   secrets. Use a dedicated funded **testnet** account. Never paste a wallet key into chat.
2. Run the **deploy-testnet** workflow on the updated source branch. It must complete
   deployment, dependency verification and saving `deployments/harbinger.json`.
3. Run the indexer and optional sponsor on a server using that manifest. Set
   `OSP_SPONSOR_WIF`, `OSP_SPONSOR_PUBLIC_URL`, and `OSP_SPONSOR_REGISTER=true`
   for the sponsor. Give the sponsor tKOIN and verify its discovery endpoint.
4. Configure the web build with `VITE_OSP_INDEXER_URL` and `VITE_OSP_SPONSOR_URL`,
   or include those public URLs in the deployment's `indexers` and `sponsors` arrays.
   Rebuild the frontend after the deployment manifest is committed. A GitHub Actions
   bot commit may not trigger another workflow automatically; run **deploy-web** if needed.
5. Verify `/v1/status` reports the correct chain and eight contract addresses, and
   the indexer has caught up. Use `npm run verify:testnet` for the contract checks.
6. Load the updated extension build from `apps/extension/dist`. The extension's V1
   interface covers feeds and cross-posting; Messages and Tokens are in the web app.

## Test with two accounts

Use separate browser profiles or a normal window and a private window. Export both
recovery files before proceeding. Test accounts and tokens have no monetary value.

| Test | Expected result |
| --- | --- |
| Create/register both accounts | Each reports registered; refresh preserves the account. |
| Post publicly | Both accounts see the post. |
| Request/accept friendship | Both can read private posts created before acceptance once each author unlocks. |
| Remove, reverse the request direction, and re-accept | Old posts and posts from disconnected periods become readable in both directions after sharing. No reposting required. |
| Remove the friendship | New private posts from **either** side cannot be read by the former friend. Earlier content may remain readable. |
| Messages: enter the other address | A message request appears. Sending stays disabled until the recipient accepts. |
| Accept, send, and refresh | Both can read the encrypted message history. |
| Interrupt a message submission, then refresh | The saved message can be checked/retried without creating a duplicate. |
| Close or block the conversation | New messages are rejected. Closing requires a new request and acceptance before resuming. |
| Support another account's post | The support is recorded once; capped rewards appear in Tokens. Self-support fails. |
| Send action tokens | The recipient receives tokens and their remaining token-backed capacity. Transfers require owner authority and self-paid Mana. |
| Send the same tokens back | No fresh capacity is created by the round trip. |
| Use the allowance, then wait | Capacity regenerates with block time, up to its limit over 24 hours. |
| Lock/unlock and restore a recovery file | Account access returns; messages can be decrypted with the correct identity seed. |
| Cross-post through the extension | One protocol publication appears; retrying the queued attempt does not duplicate it. |

## Legacy v1 pilot token rules

These rules apply to resource-version-0 deployments. For the five-day recharge
upgrade, use the [v2 tester guide](token-v2-testnet.md). The Tokens page identifies
the connected contract policy; do not assume a client update upgrades the contract.

The test token is OSAT, with whole-token precision. These are explicit **pilot defaults**,
not approved mainnet economics: 100 free actions per account, one extra action of capacity
per token, 24-hour full regeneration, one token per eligible Support action, at most
10 rewarded tokens per recipient per UTC day and 1,000 network-wide per UTC day.
The supply ceiling is 1,000,000. Reward settings may be changed by the token contract
account within hard bounds. No unlimited mint or public faucet method exists.

Posting/editing, positive reactions, friend requests, follows, message requests,
messages and Support cost one action each. Accepting/closing requests, blocking,
unfriending, recovery and key distribution do not spend action credits. Mana is
separate: every transaction still requires a funded payer or a sponsor.

Transfers move proportional remaining token credits; they do not replenish free credits.
Support is unique per actor and post, and cannot target the actor's own post or a blocked
party. These limits bound rewards; they are not a complete defense against multiple-account
farming. Tokens do not affect ranking, moderation or voting.

## What a test report should include

### Zero-Mana transaction errors

The chain can report `missing expected field in transaction header: rc_limit` when a
transaction has `rc_limit: "0"`. Older clients could submit that transaction after a
sponsor refusal fell back to an unfunded account, hiding the original refusal. Updated
clients stop before signing or broadcasting and preserve the sponsor's rejection reason.
In Settings, confirm the HTTPS sponsor URL, select **Sponsors only (never pay myself)**
while testing sponsorship, and save endpoints. Existing browser settings override build
defaults; replacing the frontend does not erase an account or its saved settings.

### Reporting a failure

Send the action, the exact error, device/browser, and transaction ID if shown.
For a missing item, include whether the indexer has caught up. Never include a
private key, recovery file, passphrase, decrypted private post or private message.

Independent security review, live resource measurements, sustained pilot testing,
and decisions on mainnet economics remain release gates for a production launch.

## Automated live product journey

Run `node --import tsx scripts/test-product-testnet.ts --execute /absolute/private-checkpoint.json`.
This is explicitly testnet-only and creates two disposable identities. The checkpoint
contains their seeds and must remain private, outside the repository and website.
The runner records completed steps and uses actual frontend publication, decryption,
and history-sharing code. It checks registration, public/private posts, non-friend
exclusion, both friendship directions, removal, re-acceptance with historical recovery,
encrypted messages, Support rewards, closure and blocking. An incomplete run is not a pass.

Typecheck it with `npx tsc -p scripts/tsconfig.product.json --noEmit`. Full offline gate:
`npm run build:all && npm test`. Contract generation pins protoc 36.2 so a build does
not depend on a changing latest-version lookup.

Attachments by URL are supported for Everyone posts. Such files remain public at
their original host; the reference client prevents them from being mistaken for
encrypted friends-only attachments. Private media hosting/uploads are not implemented.
