# Five-day recharge testnet release

This release upgrades **resource accounting** on the existing Harbinger token
contract. It keeps the same accounts, OSAT balances, friendships and posts.
The website Tokens page detects the contract policy rather than assuming the
upgrade has happened.

## Included

- 100 free units per account; one OSAT adds one paid unit.
- Each used unit recovers one tick per block, up to 144,000 ticks (about five days).
- Idle tokens cannot accelerate another token's recovery.
- Fractions combine across free and paid units to fund a whole action. Free
  capacity is used first. Spending recovering capacity delays its full recharge.
- Only individually fully charged tokens can transfer or burn. Usable action
  capacity and transferable tokens are different numbers.
- Wallet display: total OSAT, ready to send, locked, free and paid capacity.
- The existing capped Support reward pilot remains active. This release does
  **not** activate SWARM reward allocation or burn-funded promotional placement.
  Their economic parameters remain undecided.

## Upgrade and migration

The deployer uploads the token bytecode and calls owner-only `activate_recharge`
inside one transaction. The chain records the cutoff height and timestamp. A
revert rolls back both operations. Other protocol contracts retain their current
addresses and code. An unexpected derived address aborts deployment.

Accounts migrate lazily on first use. Reads preview migration without writing.
Legacy daily recovery stops at the activation timestamp. The resulting credits
convert exactly from scale 1,000 to scale 144,000. Full units remain ready; at
most one unit has a partial charge, and other depleted units start at zero.
Then v2 recovery advances from the cutoff block. Supply and balances are unchanged.
The old aggregate state cannot reveal which historical units were spent, so this
is an explicit migration rule, not a reconstruction of missing histories.

`account_state` retains the legacy field numbers and scale for old clients.
V2 clients use `resource_version`, `block`, `free_ticks`, `token_ticks`,
`transferable`, `locked`, `recharge_blocks`, and `ticks_per_unit`. Indexers are
projections; the chain read supplies current recovery and transfer eligibility.

Do not downgrade the bytecode to v1 after activation: v1 does not understand the
new ledger or locks. Any corrective upgrade must retain the v2 storage format.

## Storage bounds

Each account has two sparse trees with 262,144 reusable deadline slots and depth
18. A token unit's exact maturity is stored; histories are never averaged.
Aggregate count and deadline sums permit whole subtrees to expire or deplete in
constant work per visited node. Generation floors invalidate cleared descendants.
One operation traverses a fixed number of tree paths, not every historical
cohort. Reads cache nodes; read-only calls never persist the cache. Maximum
supply is still the existing one-million-OSAT testnet cap.

The mock VM dependency compares binary database keys as UTF-8 strings by default.
The test harness corrects this to byte order, including transaction checkpoints;
it also copies stored bytes out of transient WASM argument memory. A regression
test proves distinct binary keys and copied values survive rollback.

## Tester checklist

Use Harbinger test identities and the supplied website build. On Tokens, confirm
that the screen says **144,000 blocks / about five days**. A legacy-policy message
means the connected token contract has not been upgraded.

| Test | Expected result |
| --- | --- |
| Sign in with an existing account | Same identity, posts and OSAT balance |
| Create an account | 100 free units, zero OSAT |
| Post, like, send a request or message | Free capacity is consumed first |
| Read the wallet repeatedly | Reading never consumes, refills or truncates capacity |
| Exhaust 100 free units | One whole action recovers after 1,440 blocks (about 72 minutes) |
| Use one paid unit | One token locks; that unit recovers over 144,000 blocks |
| Hold extra unused OSAT | The depleted unit's rate stays the same |
| Have 100 paid units at 20% charge | 20 usable actions, zero transferable tokens |
| Attempt a transfer/burn of a locked unit | Rejected; balance and supply stay unchanged |
| Wait until a token is fully recharged | It becomes transferable again |
| Send ready tokens back and forth | Balances move; depleted units never refill |
| Unfriend/block/close a conversation while depleted | Safety actions still work |
| Repeat use, refresh and reconnect | Consistent state from chain; no extra recharge streams |

A sponsor still pays real Koinos Mana. OSAT recovery does not create Mana or
bypass sponsor limits. Report the operation, account address, transaction ID,
block number, expected result and actual result. Never send account seeds or
private keys.

## Release procedure

`token-v2-testnet.yml` runs only on the dedicated rollout branch or explicit
workflow dispatch. It builds all workspaces, runs all tests and the actual WASM
bootstrap, upgrades only `token`, verifies deployed code and policy, and retains
the deployment record and client artifacts. Normal development/PR pushes do not
deploy. Local command: `node --import tsx scripts/deploy-contracts.ts --network
harbinger --only token` with the existing repository deployment credentials.
