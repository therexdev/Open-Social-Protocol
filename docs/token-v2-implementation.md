# Token v2 implementation status

The accepted direction is specified in [ADR 0008](adr/0008-token-v2-shared-recharge.md).
The current site and Harbinger contracts still run the v1 pilot. This work starts
the redesign with a verified resource model; it is not a token deployment or a
completed SWARM/ad product.

## Completed in this branch

- [x] Exact, integer, block-based five-day recovery per used capacity unit.
- [x] Partial credits combine into usable actions without creating extra recharge.
- [x] Fully charged tokens may transfer/burn; depleted ones stay locked.
- [x] Paid action use and either direction of voting consume the same capacity.
- [x] Free credits use identical recovery but cannot fund reward-voting weight.
- [x] Receiving tokens and transfer round trips cannot accelerate existing depletion.
- [x] Candidate v1 aggregate-credit migration preserves balances and capacity exactly.
- [x] Tests compare compressed cohorts against an independent individual-unit oracle.
- [x] 1,000 repeated use/recharge cycles, 3,000 mixed operations and block-by-block precision.
- [x] Reproducible comparison of 25/50/100 free units across burst/even traffic.

Run `npm run test:token-v2` for strict TypeScript checking and the focused tests.
The standard `npm test` already discovers `scripts/token-v2-model.test.ts`.
Run `npm run simulate:token-v2` to reproduce [the report](token-v2-simulation.md).

## Next implementation packet: deployable resource accounting

| Area | Required behavior | Acceptance evidence |
| --- | --- | --- |
| Contract storage | Preserve independent recharge histories with bounded reads, writes and settlement work | Adversarial long-history resource benchmarks; no loop over all token holders or history |
| Arithmetic | Fixed per-unit rate, exact fractional remainder, no overflows or repeated-read truncation | Same scenarios as the reference, plus maximum-balance/block-delta cases in the Koinos VM |
| Protocol reads | Expose schema version, recharge blocks, precision, free policy, available capacity, locked and transferable balance | Old client fails clearly or keeps compatible semantics; new client detects v1/v2 accurately |
| Activity consumption | Existing authenticated caller/actor checks; free then paid resource cost | Unauthorized direct consumption fails; depleted account can still block/unfriend/recover |
| Transfers and burns | Owner authority; ready paid units only; atomic balance/supply/capacity accounting | One-unit partial locks, fractional pooling, round trips and mixed burn/transfer histories |
| Events/indexer | Canonical block/version metadata and deterministic projections | Full replay and reorg replay reconstruct balances and policy; projections never grant recharge |
| Sponsor | Explicit new-method allowlist and cost limits; never arbitrary transfer/burn authority | Device authorization and sponsor refusal tests plus actual testnet Mana measurements |
| Clients | Available actions, paid vote capacity, locked tokens and transferable tokens shown separately | Fresh account, depletion, incremental recovery, cross-account transfer and old deployment tests |
| Migration | Authenticated finalized cutoff, preserved supply/credits and identity; prevent simultaneous v1/v2 spending | Snapshot reconciliation and restartable testnet rehearsal before deployment |

The legacy fields `free_credits` and `token_credits` have a scale of 1,000. The
reference uses 144,000 internal ticks per capacity unit. Do not change existing
wire-field interpretation without versioning: expose explicit precision and new
state/read types or preserve legacy display fields alongside exact state.
The reference's array loops are deliberately **not** pasted into a contract.

## Reward voting packet

- [ ] Define post/version eligibility, voting window, replay/uniqueness, changes and
  cancellations, and exact treatment of deleted/blocked/private content.
- [ ] Select a testnet budget/issuance policy, bootstrap distribution, allocation
  curve, rounding, zero-positive-score behavior and payout path.
- [ ] Record vote direction and consumed paid weight; never derive an old vote's
  weight from a later wallet balance.
- [ ] Preserve the rolling recharge clock across vote windows and settlement.
- [ ] Stop v1 fixed-mint Support after v2 reward activation; avoid duplicate rewards.
- [ ] Validate distribution invariants and simulate reciprocal accounts, purchased
  influence, downvote attacks, low participation and reward concentration.
- [ ] Wire up/down controls into the website and extension with explicit transaction
  status, current available weight and economic error messages.

## Promotion packet

- [ ] Choose what is purchased: campaign windows/placements, not assumed impressions.
- [ ] Define pricing, contention, burn timing, reservation/cancellation and expiry.
- [ ] Bind authorization to the exact public post/version and approved burn amount.
- [ ] Record campaign start, recurrence, end and budget/cap in canonical events.
- [ ] Keep post identity, original timestamp and reward eligibility across resurfacing.
- [ ] Implement labeled placements on participating feeds without bypassing audience,
  block, mute, removal or frequency rules.
- [ ] Simulate promotion/reward feedback and prove there is no direct duplicate-mint path.

## Unchosen economics

No silent decision has been made about reducing the 100 free-unit baseline, changing
individual action costs, adopting SWARM's inflation rate/curve, allocating initial
voting tokens, or setting promotion prices. The resource model can compare allowance
sizes now; token-distribution and promotional economics need their own evidence.

## Validation scope

The executable model has no network calls, signatures, database, deployment powers,
post/identity lookup or real token issuance. It verifies resource semantics only.
It does not prove production contract safety, resource affordability, economic
fairness, farming resistance, or advertising delivery. Those checks belong to the
packets above, not to an assertion that the simulation has deployed the product.
