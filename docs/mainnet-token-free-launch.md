# Token-free mainnet launch policy

Status: approved launch policy. The mainnet launch implementation and configuration are in this branch; wallet funding and live activation remain operator steps.
See [deploy-mainnet.md](deploy-mainnet.md) for deployment and hosting instructions.
This document does not fund a wallet or change a running service.

## Approved starting policy

| Setting | Launch value |
| --- | --- |
| Platform token requirement | None: OSAT issuance, economic voting, minting and reward pools are deferred |
| Initial sponsor funding target | 10,000 KOIN in the operator-controlled Mana sponsor |
| Sponsored allowance | 50 Mana per protocol account per UTC calendar day |
| Lower allowance if needed | Operator-adjustable to 25 Mana per account per day |
| Additional funding | Operator may add another 10,000 KOIN |
| Social participation | No OSAT balance requirement or token-based posting/engagement allowances |
| Content storage | Hosted bodies/media; ledger records identities, actions, permissions, fingerprints and references |

The daily allowance is shared across sponsored posting, replies, reactions, poll
participation, relationships, groups, messaging and supporting protocol actions.
All device keys and private messaging aliases belonging to one protocol account
must share that account's allowance. It is an account allowance, not proof of a
unique person: independently registered accounts remain separate identities.

The allowance governs our sponsorship. A user can use their own Mana according to
their chosen payment preference after the sponsored allowance is exhausted. The
service must not silently change that preference.

The operator can lower the allowance without resetting spent usage. An account
already over a newly lowered allowance receives no further sponsorship until its
next UTC day or a later policy change. There is no automatic switch to 25 Mana and
no automatic wallet top-up.

## Capacity assumptions

KOIN supplies up to an equal amount of Mana, with approximately 20% of total
capacity regenerating per day. Using Mana does not burn the KOIN funding the pool.
Reference: https://docs.koinos.io/overview/mana/

| Sponsor balance | Maximum Mana capacity | Approximate regeneration/day | Full 50-Mana allowances/day | Full 25-Mana allowances/day |
| --- | --- | --- | --- | --- |
| 10,000 KOIN | 10,000 Mana | 2,000 Mana | 40 | 80 |
| 20,000 KOIN | 20,000 Mana | 4,000 Mana | 80 | 160 |

These are theoretical steady-state figures before operational overhead and assume
every listed account consumes its entire allowance every day. Lighter usage
supports more active accounts. The initially full 10,000-Mana capacity covers 200
complete 50-Mana allowances before considering regeneration; this is not 10,000
Mana of renewable daily capacity. Sponsorship always depends on available pool
resources, even when an individual account has unused daily allowance.

## Implementation requirements

1. Replace the launch policy's daily operation-count gate with a real Mana budget.
   Fifty Mana equals 5,000,000,000 atomic RC under the existing eight-decimal units.
   Retain transaction-size validation, authorization, duplicate prevention and
   short-term abuse protection.
2. Resolve the authenticated protocol identity for public actions and authorized
   devices. Private aliases must be durably associated with the account that
   authorized their allocation; rotating aliases/devices must not create extra
   daily allowances. Unverified attribution must fail closed.
3. Reserve the signed transaction's maximum RC before co-signing/broadcast.
   Concurrent requests must see reservations. Settle against verified canonical
   receipt consumption, release unused capacity after confirmation, and retain
   reservations for unknown outcomes until reconciliation.
4. Persist account/day spending and unresolved reservations across service
   restarts. Changing the allowance must not reset usage. Charge reverted
   transactions for the Mana actually consumed.
5. Advertise the sponsorship allowance and UTC reset rule in service discovery,
   and show allowance exhaustion separately from token balances and storage
   quotas. Provide aggregate pool capacity, consumption and regeneration views.
6. Implement an explicit token-free mode across contracts, website, extension,
   indexer and sponsor. Explicit token-free dependency flags are required in
   messaging and media; leaving the token contract undeployed alone is insufficient.
   Review existing native-KOIN media charges for the intended free social launch.
7. Preserve versioned ledger events, identifiers, storage layouts and a controlled
   upgrade path for enabling the economic modules later. Historical engagement
   does not automatically earn future tokens; future economic rewards require
   separately defined activation and eligibility rules.

## Activation boundary

Before mainnet launch, implement and test the requirements above, configure the
mainnet contracts/services and hosted content, identify and fund the intended
sponsor account, and verify the 50-Mana cap under concurrent requests, account
recovery, multiple devices, private aliases, UTC rollover, service restarts and
uncertain transaction outcomes.

The legacy sponsor's operation-count quotas are not this Mana allowance. Mainnet
configuration selects the durable Mana budget; other networks retain their existing policy.
Funding is a separate operator action; no 10,000-KOIN transfer has been performed
as part of recording this plan.
