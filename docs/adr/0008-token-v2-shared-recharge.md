# ADR 0008: OSAT shared recharge, reward voting, and promotion

Date: 2026-09-26

Status: direction accepted; resource reference model implemented and tested;
contract integration and economic parameters pending. This ADR does not describe
the currently deployed token contract.

## Product decision

OSAT will have three uses:

1. Regenerating capacity for protocol activity.
2. Consumed voting capacity for positive and negative allocation of a shared
   author-reward budget, inspired by SWARM.
3. Permanent burning for defined promotion opportunities on participating clients.

Activity and voting use the same paid capacity and the same rolling recharge
duration. New free accounts must not receive economic reward-voting weight.
Holding more unused tokens must not accelerate a previously used token's recovery.

The previous positive-only, fixed-mint Support mechanism is the **v1 pilot**.
It is not the selected reward mechanism for v2. A lower free allowance is under
consideration; 100 remains the baseline until simulations and product journeys
justify a replacement. No reward rate, inflation policy or promotion price has
been approved by accepting this direction.

## Resource rules

The reference model uses 144,000 blocks for full recharge: approximately five days
at a three-second block interval. Block count is authoritative; elapsed wall time
is an estimate. Each capacity unit has an integer charge from 0 to 144,000. It
recovers exactly one internal tick per subsequent block until full. Ticks represent
capacity, not newly minted OSAT. The current whole-token precision is retained in
this model; fractions are internal capacity accounting.

Unused full units contribute no recharge to other units. Reading state, receiving
tokens, transferring ready tokens, and settling rewards cannot accelerate or reset
another unit's recovery. A new action starts depletion at its inclusion block;
there is no global daily/five-day reset.

Fractional capacity combines across units. A pool of 100 empty units has one action
available after 1,440 blocks, approximately 72 minutes. This can be spent immediately.
If unused thereafter, every unit is full after 144,000 blocks. A single empty unit
has only 0.2 capacity after 28,800 blocks, whether the account holds one token or
one million. When a recovering unit is reused, only the amount actually consumed
is removed; its one existing recharge stream continues. Reuse never creates a new
stream in addition to the old one.

The deterministic consumption policy drains the least charged usable units first,
then fully charged units. Actions draw free capacity first, including fractions,
then paid capacity. Votes draw paid capacity only and consume capacity equal to
their recorded weight. Both vote directions pay the same resource cost. A vote
cannot consume one unit and use the entire account balance as weight.

Token principal remains owned while used. Only individually **fully charged** paid
units can be transferred or burned; free units never can. Thus 100 partially charged
tokens may collectively provide 20 usable action credits while all 100 token units
remain locked for transfer. The transfer restriction is not inferred by rounding
aggregate credits: doing so would let fractions erase individual recharge histories.
The locked/available distinction must be visible in the future wallet UI.

## Exact accounting model

`research/token-v2/model.ts` implements immutable state transitions using BigInt.
Identically charged units are grouped into cohorts. Distinct charge histories are
never averaged. For example, two units at charges 0 and 0.2 must not become two at
0.1: averaging would make the first recover earlier than the agreed rule permits.

`useActions` consumes combined capacity. `useVoteWeight` implements the resource
charge for voting but does not authorize or record a ballot. `transfer` moves only
ready paid units. `burn` permanently removes ready paid units and their future
capacity but does not create an advertising campaign. `fromLegacySnapshot` supplies
a candidate, exact-capacity migration mapping for later review.

These functions are an offline reference, not a deployable contract. They are not
exported from the production SDK, called by clients, or registered as transaction
entry points. Cohort iteration in TypeScript establishes arithmetic semantics,
not a safe Koinos execution bound. No live state, release bundle or deployment
manifest is changed by this ADR.

## SWARM adaptation

Keep the proposal's shared reward budget, opposing weighted evaluations, nonnegative
author allocations, and independently reconstructible settlement. Replace its
vote-linked-until-settlement lock with the agreed shared, rolling resource charge.
This is an adaptation of SWARM, not its unchanged implementation.

A ballot records the capacity consumed when cast. That recorded weight does not
shrink as tokens recharge and does not grant a free repeat vote. Ballot uniqueness,
changes/cancellations and duplicate transaction handling require explicit contract
rules. Settlement must not unlock/refill resources. The evaluation window and reward
accounting period remain separate bookkeeping decisions; neither introduces another
token recharge mechanism. A late vote cannot receive a shorter recharge by crossing
a period boundary.

Pending decisions: reward budget/issuance rate; allocation curve and constants;
eligible post types and content versions; evaluation window; vote changes; protected
downvote capacity, if any; zero-score/empty periods and rounding; bootstrap
distribution; when earned tokens enter voting; and deterministic automatic payout
or claim mechanics. No indefinite public mint or operator-selected payout is implied.

## Promotion direction

Burn ready tokens for a defined, labeled promotion opportunity. A prospective
campaign can reference an existing public post, a start/end block, recurrence and
a maximum number of opportunities. Resurfacing must preserve the original post ID,
author, date and conversation; it must not reopen reward eligibility through copies.
Promotion to a broader audience must never decrypt a friends-only post.

Independent clients choose whether and how to display promotions. The protocol can
prove payment and eligibility, not force impressions across all frontends or Facebook.
Our website and Open Social cards in the extension can honor the same campaign record.
Visibility must continue to respect blocks, mutes, removals and per-viewer limits.

Pending decisions: eligible campaign types; pricing and opportunity allocation under
congestion; burn timing versus reservation; cancellation/expiry and undelivered
opportunities; display limits; and interaction between paid exposure and author rewards.
Burns are irreversible. No guaranteed impressions, profitability, or token price follows.

## Free usage and abuse

Compare 25, 50 and 100 free units using the same recharge rule; do not silently select
a reduction. The initial simulation assumes one credit per action for comparability,
not a finalized schedule for posts, edits, likes or messages. Existing protective
operations (blocking, unfriending, accepting/closing requests, recovery and key sharing)
must remain usable when ordinary capacity is exhausted.

Free credits cannot fund reward votes, transfers or promotion burns. Resource scarcity
does not establish personhood: multiple accounts can still consume free allowance.
Sponsorship limits and independent-account abuse remain separate concerns. Voting
can remain concentrated even with negative votes; simulations of wallet recharge do
not establish resistance to collusion or reward farming.

## Integration and migration sequence

1. **Reference accounting (this change):** exact recharge, pooling, locks, shared
   voting consumption, conservation, allowance comparison, candidate migration.
2. **Contract port:** derive and test bounded storage/execution for adversarial
   histories, integer limits and rounding; implement schema-v2 policy/account views,
   atomic consumption, owner-only ready transfers/burns, and canonical events.
   Cross-contract consumption stays restricted to authenticated protocol actions.
3. **Voting/settlement:** resolve the listed economics, implement ballot and payout
   invariants, remove v1 per-Support issuance after activation, and establish an
   inspectable testnet bootstrap. Include reciprocal farms, rich attackers,
   downvote brigades, vote/transfer cycles and settlement-boundary scenarios.
4. **Clients/infrastructure:** SDK/proto types, indexer projections/replay, sponsor
   method policy, available-vs-locked wallet UI, up/down controls, failed-action
   explanations, web/extension parity and visible deployment-version handling.
5. **Promotion:** implement campaign authorization and burns only after pricing and
   delivery semantics are specified; integrate bounded placement into participating
   feeds and test spam, privacy, rewards and cancellation interactions.
6. **Testnet cutover:** retain the existing identity and post history, audit a
   finalized snapshot, rehearse migration and total-supply reconciliation, update
   all dependent contract addresses if using a replacement, then verify complete
   real account journeys and resource costs. Publish the actual cutover and policy.

The existing contract stores aggregate credits and cannot recover historical token
cohorts. The reference migration candidate preserves balance and exact available
capacity using full units, at most one partial unit, and empty units at an explicit
cutoff block. This does not claim to reconstruct past use. A new contract cannot
silently treat existing depleted balances as fully recharged or mint replacement
balances without authenticated snapshot accounting and a no-double-spend cutover.

Reward and promotion economics remain testnet proposals until validated. The accepted
five-day resource direction does not authorize inventing final rates or deploying an
unbounded model over the working product.

## Evidence and reproducibility

```sh
npm run test:token-v2
npm run simulate:token-v2
```

The model tests also run as part of the existing `npm test` script-tests gate.
See [simulation results](../token-v2-simulation.md), the
[implementation checklist](../token-v2-implementation.md), and the original
[SWARM proposal](https://github.com/levineam/proof-of-value/blob/1861c75a31508108bd8ef64b226c3206fde53190/WHITEPAPER.md).
Koinos reference: [Mana](https://docs.koinos.io/overview/mana/) and
[resource/block-period documentation](https://docs.koinos.io/architecture/resources/).
