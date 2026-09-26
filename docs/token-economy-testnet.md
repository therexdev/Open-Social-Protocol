# Voting, rewards and promotion: Harbinger pilot

This release adds paid up/down votes, a shared author-reward budget and promotion
purchased by burning OSAT. The five-day resource contract is already deployed.
The new economy has a separate activation switch: uploading code does not retire
Support or expose partially deployed features. See [ADR 0009](adr/0009-token-economy-testnet-pilot.md)
for exact pilot parameters and [the implementation status](token-v2-implementation.md).

## Tester behavior after activation

- Accounts keep 100 free activity units. Free credits cannot vote. Ask the test
  operator for an allocation to your **public account address**; never send keys.
- Open another person's active public post, choose Upvote or Downvote, choose a
  whole paid weight, and confirm. One final ballot per account and post. Weight
  consumes that much paid capacity, with the existing five-day rolling recharge.
- The first vote places a post in the current five-day reward period. Editing the
  evaluated version closes further voting and makes its unsettled reward zero.
  Posting again or promoting the same post does not reopen its reward window.
- The period's 100 OSAT budget is divided among positive-scoring posts. This is a
  shared budget, not 100 tokens per post. Pending amounts can change. Downvotes
  reduce pending allocation; they do not confiscate already owned tokens.
- When voting closes, use **Settle author reward** on the post or **Tokens →
  Pending rewards**. Anyone with signing permission may submit it; the payout
  always goes to the recorded author. Settlement never refills the voter's used
  capacity. Unclaimed rewards do not expire.
- On your public post, **Promote** offers one to five opportunities. Each costs
  one fully charged OSAT and lasts 1,200 blocks (about an hour). The confirmation
  binds the post version, price and campaign nonce. Burning is permanent; no
  activity credits are consumed. Cancellation stops eligibility without a refund.
- Participating feeds label paid placements, preserve organic timestamps and
  cursors, and apply audience/block rules and local mutes where supported. There
  are at most two selected promotions in a feed page, after three organic posts
  and then ten apart. Visibility is an opportunity, not guaranteed impressions.
- Extension 0.1.7 opens a trusted confirmation tab from Facebook cards. Older
  device grants need **Settings → Devices → Enable reward voting** on the website.
  A device can vote only with that permission; burning requires the owner key.

### Useful repeated checks

| Scenario | Expected result |
| --- | --- |
| Vote with only free credits | Refused, no ballot or paid weight created |
| Upvote/downvote with weight 3 | Three paid units consumed and locked; free capacity unchanged |
| Vote twice, or vote on your own post | Refused without a second debit |
| Add tokens or settle a reward while units recharge | Existing units keep their original recovery rate |
| Transfer/burn a partly charged unit | Refused even if pooled fractions can fund an action |
| Hide/delete/change the voted version, then settle | Zero author reward, no refund of voting capacity |
| Try to promote private content | Refused; no expanded audience or new key sharing |
| Repeat a promotion transaction | No duplicate purchase; active campaign/nonce checks reject it |
| Cancel and purchase another campaign | A new explicit burn and nonce are required |
| Refresh, revisit, or load more feed pages | Organic order retained; frequency limits apply |
| Lock the extension or revoke its voting permission | New votes cannot be signed |

## Release and service deployment

1. The dedicated `codex/token-v2-testnet-rollout` workflow builds and tests all
   workspaces. It first deploys a **separate disposable token contract** on
   Harbinger, executes real paid votes and burns, waits for its short reward
   period, and checks exact payouts, supply, locks and replay refusal. Only this
   isolated rehearsal uses a 60-block reward period; recharge remains 144,000.
   Public transaction receipts are retained in `token-v2-testnet-evidence`.
2. Only after that rehearsal passes, the workflow upgrades the existing token
   account, verifies bytecode/dependencies and repeats the real product journeys.
   The public economy remains inactive until the service gate passes.
3. Deploy this source revision to the existing indexer and sponsor hosts, using
   their existing private environment and service manager. Node 22.5+ is required:

   ```sh
   npm ci --no-audit --no-fund
   npm run build -w packages/proto -w packages/sdk -w apps/indexer -w apps/sponsor
   ```

   Stop/restart those services through their existing process manager. Preserve
   the indexer database and sponsor quota database. The indexer migrates to schema
   3 automatically. Upgrade it **before activation**, so it indexes every new
   economy event. `/v1/status` must be healthy, have the correct chain/token, and
   report `features.tokenEconomy: 1`.

   Sponsor policy version defaults to 2. If the environment overrides
   `OSP_SPONSOR_POLICY_VERSION`, set it to 2 or higher. If
   `OSP_SPONSOR_ALLOWLIST` overrides defaults, add `token:vote`,
   `token:settle_reward`, `token:promote`, `token:cancel_promotion`, retaining
   existing product actions. Do not add economy administration or arbitrary
   transfer/burn. With `OSP_SPONSOR_REGISTER=true`, startup registers the updated
   policy on chain. Confirm registration and signed discovery before testing.
4. Upload the contents of `OpenSocial-Online-Testnet.zip` into the existing
   Hostinger `public_html`, retaining its root layout. The live
   `https://opensocial.online/release.json` must return JSON with `tokenEconomy: 1`.
   The rollout publishes the same build to `hostinger-static`; FTP is used only
   when repository FTP credentials have been configured. Reload extension 0.1.7.
5. Rerun the dedicated rollout workflow, or invoke the readiness-gated activation
   with existing deployment credentials in the operator's environment:

   ```sh
   node --import tsx scripts/activate-token-economy.ts --network harbinger
   node --import tsx scripts/activate-token-economy.ts --network harbinger --execute
   ```

   A failed gate never activates the economy. The workflow's `--if-ready` stages
   compatible code successfully and prints the outstanding service blockers.
   Activation is owner-only, Harbinger-only and one-time; it disables legacy
   fixed-mint Support. Do not downgrade to code that ignores this switch.
6. Allocate test tokens to an explicit list of registered tester addresses:

   ```sh
   node --import tsx scripts/token-economy-admin.ts --network harbinger --execute --grant 'TESTER_ADDRESS:20'
   ```

   The contract enforces 100 tokens per recipient lifetime and 10,000 total
   bootstrap tokens. New accounts are not an automatic reward-voting faucet.
   Credentials stay in the operator environment/GitHub secret store.

Do not describe a staged release as live voting. Report the isolated rehearsal,
public contract version, service readiness and actual activation separately.
Mainnet economics, lower free allowances, farming resistance and real promotion
engagement remain questions for the pilot; this release does not establish them.
