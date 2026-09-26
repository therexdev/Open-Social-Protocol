# V1 product audit — September 26, 2026

**Follow-up:** This initial audit missed failures in the full App sharing coordinator.
See [the follow-up audit](friendship-audit-followup-2026-09-26.md) for the reproduced
failures, corrected implementation and additional verification. The initial helper-only
live journey below did not establish that the reported UI failure was resolved.

The repaired testnet build passes the reported friendship lifecycle in both directions,
including recovery of older friends-only posts from a fresh key cache. The broader V1
audit covered the web client, extension, SDK, eight contracts, indexer, sponsor and
deployment tooling. This is an engineering audit with automated and live test evidence,
not an independent security certification or a mainnet release.

The updated static frontend must still be uploaded to Hostinger. Source changes and
local passing tests do not change the files currently served by opensocial.online.

## Findings and changes

| Finding | Repair and resulting behavior |
| --- | --- |
| Acceptance shared only the current encryption period; re-acceptance stranded older posts | Recover author keys with chain provenance and share all historical periods with current, chain-confirmed friends. A bounded 16-period pass resumes long histories. No new posts or accounts are required. |
| The requester and acceptor did not reliably finish both directions | Both unlocked authors run automatic sharing on startup, focus, online events and a timer. The Friends page exposes a manual sync and reports completed sharing. |
| Removal could be retried from stale UI state | Preflight the actual relationship, serialize account submissions, suppress duplicate clicks and refresh after outcomes. Removal rotates future keys for both parties. |
| A failed key lookup could be mistaken for no existing key | Network and provenance failures stop encryption-key creation. Existing historical periods are never assigned replacement keys during repair. |
| Sponsor transport failures and confirmation timeouts could be treated as rejection | Preserve an unknown outcome after possible submission; do not automatically replay with a second sponsor or self-paid transaction. Explicit refusals retain normal fallback behavior. |
| Account changes could let late feed or relationship responses overwrite current state | Clear prior account data, invalidate stale requests and refresh friendship views automatically. |
| A newly published post could remain on an empty detail page | Poll for indexer convergence with a truthful waiting state and retry control. |
| Message arrival required manual refresh | Refresh visible conversations, retain verified history and preserve the older-message cursor. Polls do not cancel an already running read. |
| Feed content could rely on indexer claims | Web and extension verify author, audience, current version and envelope fingerprint against chain state; authoritative deletion/hiding wins. |
| Extension keys recovered from an untrusted read cache could be used for publishing | Both clients use the shared SDK provenance verifier. Unverified extension cache entries are not encryption authority; unavailable verification stops publication. |
| URL attachments could imply privacy they did not provide | Friends-only publication rejects linked media files and explains the limitation. Public URL attachments remain available. |
| Build/check entry points were fragile | Pin contract protoc to 36.2 and run optional workspace tasks without recursively inheriting npm workspace selection. |

## Verification

`npm run build:all` completed for schemas, SDK, all eight release contracts, indexer,
sponsor, web and extension. Final client builds and `npm run typecheck` passed after
the audit changes. The opt-in live runner also passes its dedicated TypeScript check.

The full repository test gate passed. The final message-pagination change was followed
by a passing web suite and web production build. Current passing test counts are:

| Suite | Passing tests |
| --- | ---: |
| Protocol schemas | 4 |
| SDK | 81 |
| Eight contracts in the Koinos mock VM | 419 |
| Indexer | 58 |
| Sponsor | 51 |
| Web | 94 |
| Extension | 62 |
| Deployment/build scripts | 17 |
| Total | 786 |

Regression coverage includes cold-cache historical sharing in both directions, more than
16 historical periods, untrusted keys, offline lookups, account/lock/rotation races,
sponsor failure ambiguity, delayed indexing, stale account responses, altered post
content, extension key trust and message history pagination. The extension production
bundle also passed its service-worker smoke test with eval disabled and sender/origin
validation enabled. Contract release bootstrap tests exercised all eight entry points.

### Live Harbinger evidence

The test ran from **2026-09-26 02:16:46 UTC to 02:29:27 UTC**, using only two newly
generated disposable identities. The user's two existing accounts were not modified.
All **25 steps** passed. Public account addresses, transaction IDs, post IDs and results
are in [the public evidence record](audits/v1-testnet-2026-09-26.json). Identity seeds are
excluded from that record and remain outside the repository and release package.

The journey used the real frontend publication, decryption, historical-sharing and
message-verification functions against the deployed contracts and public services:

1. Register both accounts; publish and read a public post.
2. Publish private posts before friendship; confirm a stranger cannot decrypt.
3. Request and accept friendship; recover keys from empty caches and read both authors' older posts.
4. Remove friendship; publish from both accounts; confirm neither can decrypt the other's new posts.
5. Request from the opposite account and accept; recover from empty caches and read all four private posts, including both original posts and the posts made while disconnected.
6. Request and accept a conversation; send encrypted messages both ways and verify each as sender and recipient.
7. Support the public post; verify the author's reward balance.
8. Close the conversation, block the peer and confirm the relationship is inactive and sharing sends nothing.

A final read-only check verified the public post and all four private posts with
independent chain author/version checks and fresh key recovery.

`verify-deployment.ts` verified the chain ID, upload receipts, bytecode hashes, current
ABIs, dependency addresses and registry entries for all eight deployed contracts. The
indexer was healthy and caught up when checked. The configured sponsor successfully
paid the live journey; the on-chain sponsorship registry currently lists zero sponsors,
so clients rely on the explicitly configured sponsor URL.

Browser smoke checks covered the public onboarding and Settings routes without app
console errors. Authenticated journeys were verified through rendered component tests
and real testnet client calls; a full authenticated mobile-browser journey was not run.

## Reproduce and deploy

```sh
npm run build:all
npm run typecheck
npm test
npx tsc -p scripts/tsconfig.product.json --noEmit
npm run verify:testnet
node --import tsx scripts/test-product-testnet.ts --execute /absolute/private-checkpoint.json
```

The last command submits real testnet operations and creates disposable accounts.
The checkpoint contains test identity seeds: keep it private and outside the repo.
Reads may be retried; the runner does not blindly retry mutation failures. Completed
steps are checkpointed, and publication attempts reconcile their stable idempotency IDs.
Other uncertain mutation outcomes must be inspected before resuming.

Follow [the website deployment guide](opensocial-online.md) to replace the static files.
After deployment, refresh and unlock each existing account once. Historical sharing
starts automatically; **Friends → Sync private-post access** can trigger another pass.
No contract redeployment, friendship removal, account recreation or reposting is needed.
Long histories may need multiple passes, and network availability still governs completion.

## Remaining release gates and product limits

- **Independent security review and sustained pilot use:** cryptography, recovery,
  permissions, sponsor abuse limits and operational reliability need external review,
  live resource measurements and load testing before mainnet use.
- **Real-device acceptance:** mobile account creation/import, passkey enrollment and
  recovery, and authenticated browser navigation still need a real-device acceptance run.
  Tests cover the underlying vault behavior; they do not substitute for hardware tests.
- **Facebook connector acceptance:** the extension's mocked DOM, queue, protocol
  integration and production-worker checks pass. A current signed-in Facebook composer
  was not exercised, nor was a Chrome Web Store release performed.
- **Private media:** encrypted hosting/uploads are not implemented. URL attachments
  are public at their origin and are restricted to Everyone posts in the web composer.
- **Token economics:** live Support rewards were verified. Owner-paid token transfers
  and full-day regeneration were covered by contract tests, not by a day-long live run.
  Pilot economics and multiple-account reward abuse controls are not mainnet approval.
- **Revocation semantics:** removal prevents access to subsequent encryption periods;
  it cannot erase previously received keys or plaintext. Re-acceptance intentionally
  grants available historical periods, including posts made while disconnected.

The release is a verified testnet build. The source and bundle are ready for deployment;
these remaining gates should not be represented as completed production certification.
