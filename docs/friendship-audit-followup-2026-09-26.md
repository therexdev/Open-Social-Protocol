# Friendship access audit follow-up — September 26, 2026

The prior release's live runner called publication and sharing helpers directly. It did
not exercise the React component that starts synchronization, so it missed failures
that could leave an accepted friendship with access in only one direction. The user's
report was valid. Repeating removal and re-acceptance must remain a supported operation.

## Findings verified against the deployed site and chain

- The deployed website served commit `38e8968`; its JavaScript matched the supplied
  build byte for byte. This was not an old-deployment explanation.
- The affected friendship was ACTIVE when queried with either account first. The
  contract canonicalizes the pair and does not give the requester special read rights.
- The acceptor had sent its key to the requester. The reciprocal historical key
  distribution was absent. The original author's self-addressed historical key still
  existed and its provenance verified on-chain.
- In the full App, an unavailable registration lookup prevented the sharing component
  from installing **any** listeners. Friendship actions remained enabled, and manual
  Sync dispatched an event with no listener. This reproduces the one-way failure.
- A stale recipient cache could make manual Sync skip the missing distribution again.
  This also reproduces in the full App. Neither defect was covered by the old helper
  journey. We cannot inspect the user's device cache and do not claim which cached
  state was present there.

## Repairs

| Failure | Behavior in this release |
| --- | --- |
| A failed account lookup silently disables sharing | Sharing runs independently of that cached UI lookup; unavailable account checks retry on focus, online and a timer. Chain membership and keys still determine actual recipients. |
| Old recipient bookkeeping can falsely say a key was delivered | Existing reading keys are preserved. Legacy delivery bookkeeping is invalidated once. Explicit repair re-seals verified keys even if a cache names the recipient. |
| A Sync click while sharing is busy disappears | A repair request queues behind the active pass. Progress, confirmed delivery counts and actionable errors remain visible. |
| A long remove/re-add history starves later periods | The app scans all available historical keys. An inventory avoids one lookup per empty period, and a capped inventory falls back to per-period lookup without dropping old history. |
| A publication preview outlives a friend removal | Recheck the audience period inside the account's submission queue. A changed period stops submission and preserves the draft for a new review. |
| A failed first profile request leaves posts absent indefinitely | Retry failed post loads on a timer, focus and network reconnection. The profile also exposes an explicit retry and no longer labels an error as an empty profile. |
| Dialog fallback opens but cannot close | The fallback now also closes cleanly where native dialog methods are absent. |

Confirmed transactions are required before recording new recipients. Pending, removed
and blocked accounts do not receive new distributions. Historical sharing never creates
replacement keys for existing posts and does not remove received reading keys.

## Verification

The full repository gate passed **797 tests**: schemas 4, SDK 81, contracts 420,
indexer 58, sponsor 51, web 104, extension 62 and build/deployment scripts 17.
`npm run build:all` and `npm run typecheck` passed. The opt-in live App test is excluded
from this offline count and is run separately.

The contract suite now includes **1,000 consecutive cycles**, alternating the requester
and remover. Each cycle checks both argument orders, request/active/inactive status,
pair nonce and both audience periods. The upstream mock VM retains byte views into
WASM memory; its test adapter now copies stored values, matching real persistent
storage, so garbage collection cannot corrupt the long-running test database. No
production contract code changed.

The new full-App regressions reproduce registration failure, stale delivery records
and a repair clicked during a busy pass. Additional tests cover cache migration,
1,000 empty rotations, inventory truncation, a stale publication preview and post-load
recovery after a temporary indexer failure.

### Live App journey

The opt-in `Friendship.live.test.tsx` mounts the real App and interacts with its rendered
composer, confirmation dialogs and relationship buttons. It uses real Harbinger
contracts, sponsor and indexer services, with disposable test identities. Decryption
assertions inspect rendered post text, rather than calling the sharing helper directly.
This runs in jsdom; it is not a claim of physical mobile-browser or passkey testing.

The public results record is `audits/friendship-app-2026-09-26.json`. It contains only
disposable account addresses, public post/key references and completed assertions.
Identity seeds remain outside the repository and the website ZIP.

The initial App run completed 23 assertions: publishing private posts before friendship,
stranger exclusion, both request/accept directions, mutual old-post access, removal,
retained old access, exclusion of posts published while removed, and restored access
following the reversed request. A restored account then hit an indexer transport error;
the profile never retried. After repairing that behavior, the dedicated continuation
imports the same two identities into empty vaults, deliberately fails each initial
profile request, and verifies automatic recovery and rendered old/new posts in both
directions. Friendship and publication mutations are not replayed in the continuation.

## Reproduction

```sh
npm run build:all
npm test
npm run typecheck
OSP_LIVE_UI_CHECKPOINT=/absolute/new-private-checkpoint.json \
  npm test --workspace @osp/web -- Friendship.live.test.tsx
# Resume only cold-restore/read checks against the recorded identities:
OSP_LIVE_UI_RESTORE=/absolute/private-checkpoint.json \
  npm test --workspace @osp/web -- Friendship.live.test.tsx
```

The live command creates test accounts and submits testnet transactions. Use a new
checkpoint path; never blindly replay a partially completed mutation. Inspect the
recorded accounts and chain before deciding how to recover an interrupted run.

## Release boundary

This repair needs a website upload, not a contract redeployment or new user accounts.
After the updated site is loaded, each author must unlock its existing account so it
can sign its own key distributions. The other person cannot produce those signatures.
Old received keys continue to work after removal; posts using subsequent periods stay
locked until friendship is accepted again and the author shares those periods.

The hosting panel is currently blocked by its security verification page in the
available browser. The ZIP is prepared for the existing Hostinger deployment. Until
it is uploaded and the affected authors have synchronized, their live account repair
must not be represented as completed. The broader product limits documented in
`v1-product-audit.md` remain applicable.
