# ADR 0009: Complete token economy pilot

Date: 2026-09-26
Status: implementation for Harbinger testing; these are explicit pilot parameters,
not an approved mainnet issuance or advertising policy.

## Parameters and authority

| Setting | Pilot value |
| --- | --- |
| Free activity | Unchanged: 100 units, each recovers over 144,000 blocks |
| Paid activity and voting | Same existing paid pool and per-unit recharge |
| Reward period | 144,000 blocks from activation, approximately five days |
| Period budget | At most 100 OSAT, subject to the 1,000,000 circulating-plus-reserved cap |
| Score | `floor(1000 * n² / (n + 1))`, where `n = max(0, up − down)` |
| Allocation | `floor(period_budget * post_score / period_total_score)` |
| Ballot weight | A positive whole amount, at most 1,000 per ballot |
| Period weight limit | 1,000,000 paid weight across all ballots |
| Tester allocation | Contract owner only; registered recipients; lifetime 100/account, 10,000 total |
| Promotion | 1 ready OSAT burned per 1,200-block opportunity (about an hour) |
| Campaign limit | 1–5 opportunities; 32 concurrent board slots |

The contract owner activates this economy once. Activation and tester grants are
restricted to the published Harbinger chain ID. Mainnet activation is rejected.
The owner can use a 60–144,000-block **reward bookkeeping** period for an isolated
rehearsal. Public activation uses the default 144,000. This never changes the
144,000-block recharge of free capacity or any used token. Parameters are immutable
within this economy version; changing them needs an explicit versioned upgrade.
The existing upgrade controller remains a central authority during testing.

Grants emit recipient, amount, cumulative allocation and timestamp. Registration
has no voting-token faucet. Existing balances, identities, posts and resource
histories remain intact. Grants add new, fully charged units, never refill old ones.
Do not allocate tokens to assumed testers; use an explicit operator-supplied list.

## Ballots and eligibility

Only active public posts are eligible. Private content remains private and can
still receive ordinary Likes. The first ballot selects the current reward period
and exact content hash. Existing posts can enter once; a post never gets a second
reward period. One immutable ballot per account/post: no changing direction,
cancellation or free repeats. Self-voting and either-direction blocks are rejected.
Both directions consume exactly their recorded weight from paid capacity, never
free capacity. Device capability 128 authorizes voting, as it authorized legacy
Support; publishing-only devices require explicit additional authorization.

The accepted recharge semantics replace SWARM's lock-until-settlement rule. Late
votes have the same recharge as early votes. Settlement neither refunds capacity
nor resets its clock. Negative votes change pending issuance only and cannot
confiscate an author's existing balance. No separate protected downvote pool is
introduced. V1 Support and its mint-policy setter are disabled on activation.

## Settlement and arithmetic

Every vote updates one ballot, one post total and one period total. All arithmetic
is integer; bounded weights keep intermediate products within uint64. The first
vote in a period reserves its budget, accounting for every older unpaid reserve.
Claims mint only from this reservation. Burns lower circulating supply, not unpaid
reward reservations. There is no simultaneous legacy Support issuance.

After the end block, any authenticated account/device with voting permission can
settle a post. Payment always goes to its recorded author. An edited, non-public,
hidden or removed evaluated version receives zero. Other posts' denominators do
not change during claims, so order cannot advantage claimants. A zero-positive-score
period issues nothing. Division remainders and invalidated allocations stay
unissued and are released when all the period's evaluated posts are settled.
Claims never expire. Unsettled claims remain reserved and count against the cap.
There is no operator-chosen payout and no iteration over all voters or posts in a
transaction. Wallet/post controls or another protocol client can advance
claims in bounded transactions.

## Promotion and delivery

Only the author can purchase a campaign, using owner authority; ordinary device
keys cannot burn. The signature binds the exact post/version, next per-post nonce,
board slot, number of opportunities and burn amount. All checks precede an atomic
burn and campaign creation. Slot contention reverts without burning. A live campaign
cannot be repurchased; expiry/cancellation permits the next nonce. Cancellation
stops future opportunities without refunding a completed burn.

A campaign reserves a labeled placement opportunity in each consecutive
1,200-block window. It buys eligibility, not measured or guaranteed views. Independent
clients remain free to ignore campaigns. No friends-only content is promoted.
The indexer applies current public visibility, both-direction blocks and the
chosen friend-feed scope. Clients validate payment/version/expiry against the
canonical board, filter local mutes, preserve original dates/post IDs, suppress
organic duplicates and limit promoted cards. Website placements start after three
organic posts and are spaced ten organic posts apart, with at most two selected
cards. A viewer session sees each campaign opportunity at most once; existing
visible cards stay stable. Extension host insertion also retains its existing
one-post-per-page-session deduplication. Unserved opportunities are not refunded.

Promoting an old post cannot reopen reward eligibility. Paid exposure can still
influence subsequent human votes: there is no claim that advertising and token
rewards are economically independent. The fixed pool bounds issuance, not farming.

## Rollout gates

Build and test contract, SDK, indexer, sponsor, website and extension together.
New code can be uploaded while the economy is inactive: five-day resources and
legacy Support keep working. Before public activation, require an indexer advertising
`features.tokenEconomy = 1`, a sponsor advertising the four new public write methods,
and current clients. Older clients must see a clear retired-Support error after
activation rather than silently minting.

The website's Hostinger upload and live backend service updates are real release
steps, not implied by a passing build. Verify their deployed versions before
claiming readiness for ordinary testers. Rehearse activation and settlement on a
separate, seed-derived Harbinger token account so public accounts are not switched
before infrastructure is ready.
