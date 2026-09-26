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
   Readiness checks both the signed HTTP policy and its active on-chain record;
   a serving HTTP endpoint by itself does not establish registration.
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

## Recorded chain evidence

The first live rehearsal passed all 33 checks on isolated token
`1PzCuVGLLCjsKL95w6Sn6U3rftu7whAttJ`. Its
[public receipts](../deployments/evidence/token-economy-2026-09-26.json) include
72 and 27 OSAT author payouts from a 100-token budget, permanent promotion burn,
unchanged voter locks and rejection of duplicate/free/self votes. The busiest
measured new user action in that run used about 28.9 million RC, below the
current sponsor's 200 million RC per-operation ceiling.

The public token upgrade was included at block **8713616**, transaction
`0x1220e02991e53713e544328604c5006e4aa3f891595a6c279784770de5604c25ff36`.
Verified release WASM SHA-256:
`4407bf2d09147c8b6307d064e78834ab448a4942dff353294f1cbddc353c02ab`.
Public reads afterward returned `resource_version: 2`, `economy_version: 0`.

That rollout's subsequent product smoke run stopped on an unknown confirmation
outcome at koilib's 15-second default. The SDK now waits up to 120 seconds by
default, while preserving explicit overrides and never resubmitting on timeout.
The resumed [rollout](https://github.com/therexdev/Open-Social-Protocol/actions/runs/36270944959)
then passed another independent 33-check token rehearsal and all 25 real product
checks. [Repeated token receipts](../deployments/evidence/token-economy-repeat-2026-09-26.json)
and [public product results](../deployments/evidence/token-economy-product-2026-09-26.json)
are retained in the repository. CI passed 924 tests, with two existing web tests
skipped; builds, type checks and browser/WASM smoke checks also passed.

As of that successful rollout, public activation remains deliberately blocked by
the old live indexer, sponsor policy and Hostinger site. The updated website is
published on `hostinger-static`; no FTP deployment credentials were configured.
Deploy the backend services and website as described above, then rerun the gated
activation. Passing the rollout while `ready: false` means **verified and staged**,
not active voting for ordinary testers.

## Sponsor registration repair

The September 26 VPS restart exposed a pre-existing registration failure:
`set_sponsor` reverted with `module exited due to trap`. The generated
AssemblyScript decoder handled the repeated `entry_points` field only as
unpacked values, while koilib/protobufjs sends its valid packed representation.
AS-only contract tests used the same unpacked writer and missed the mismatch.

The build now corrects generated repeated-uint32 decoders to accept packed,
unpacked and mixed chunks with bounds checks. No schema, entry-point or account
address changes are required. The release-WASM test now submits the service's
actual policy and checks wire compatibility, malformed lengths, maximum policy
size and authority. Activation additionally requires an active on-chain sponsor
record matching its signed discovery policy and limits.

The `sponsor-registry-testnet` workflow first runs those tests and an isolated
Harbinger registration rehearsal, then upgrades **only sponsorship** in place.
After a successful upgrade, restart the existing `osp-sponsor` process so its
own retained key can register the policy. The contract deployer cannot register
on the real sponsor's behalf. This workflow does not activate the economy;
complete sponsor registration and website deployment before gated activation.

The [repair rollout](https://github.com/therexdev/Open-Social-Protocol/actions/runs/36274012319)
passed the full test suite, 60 successful release-WASM calls and all 14 isolated
live registration checks. The public sponsorship upgrade was confirmed at block
**8714836**, transaction
`0x122002477dba961cec2fb1ef117a939984ffc1e668cd79772765af50586f78949a12`.
[Public receipts](../deployments/evidence/sponsor-registry-2026-09-26.json) retain
the tested bytecode hash, isolated registrations and public upgrade. The other
seven deployment entries were unchanged. The live sponsor still needs a restart
to register with its own key; the website upload and economy activation remain
pending.
