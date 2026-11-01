# Public polls

Polls are native publications with a question, 2–8 answers, and a closing time. An account may select one answer and change that selection before closing. Answering does not create, replace, or cancel a token upvote/downvote. Existing token voting weights, costs, finality, and reward calculations are unchanged.

## Participation weight

The publications contract records `engagement_milli = floor(sqrt(N * 62500))`, where N is the number of distinct participating accounts other than the author. Divide by 1000 for engagement points: one account = 0.250, two = 0.353, four = 0.500, sixteen = 1.000. Answer changes do not increase N. The author's ballot counts in results but adds no engagement.

This is a separate protocol participation signal exposed by the SDK, indexer and UI. It is **not token issuance or an automatic reward vote**. The reference feed remains chronological; this change does not introduce a ranked feed. Frontends can consume this signal independently of approval. Likes and comments do not receive new weights in this release. Registered accounts are not proof of unique humans; usage credits and diminishing returns do not eliminate Sybil attacks.

## Protocol API

- `publications.publish` gains optional field 14, `poll_definition poll`: `question`, ordered `options`, and `closes_at` (Unix milliseconds as uint64).
- Polls must be new, public, top-level publications. The question is 1–500 UTF-16 code units, each answer 1–120, and trimmed case-insensitive duplicate answers are rejected. Closing must be 5 minutes to 30 days after chain time at creation. The reference composer offers 1 hour, 1 day, 3 days, or 7 days.
- The canonical question/options come from the poll definition, not an independently editable envelope. The reference composer uses the same question as the post text for older clients.
- Poll metadata and the publication are written atomically. Poll posts cannot be edited; deletion/hiding remains available. All historic content remains in chain history.
- `answer_poll({actor, post_id, option, device?})` uses zero-based option indices. Requires the REACT capability, an active poll, time strictly before closing, and no block in either direction. Each accepted answer/change consumes one normal activity unit; an unchanged answer is rejected. Maximum 1,000,000 accounts per poll bounds counters and work.
- `get_poll({post_id, viewer?})` returns `{value?, ballot?, now}`. A missing ballot differs from option zero. Reads are public and do not require authority.
- `poll_created` and `poll_answered` events include authoritative total snapshots. Indexers replace snapshots and upsert one ballot per account, rather than incrementing on replay.
- Storage spaces 5 and 6 are new; existing publication storage spaces and argument field numbers remain unchanged.

All answers and identities are public on chain, including previous selections. Private/friends-only polls and secret ballots are not supported. Hiding a poll in a frontend cannot erase its answers.

## Clients and compatibility

The web composer adds polls, previews choices, and retains definitions in encrypted local drafts for retry. The poll card reads the chain before enabling submission, displays totals, allows answer changes, and leaves normal reward controls separate. The extension displays poll choices/totals and links to the web poll to answer.

Older clients can still publish and react normally. Before a poll is submitted, the web publish planner calls `get_poll` to check the deployment supports it: older protobuf contracts could otherwise ignore the added field and publish an ordinary post. Custom clients must also check support. Updating the web bundle alone does not enable polls on chain.

## Release order

1. Build and test this branch. Publish the updated SDK/schema for third-party clients.
2. Upgrade the existing publications contract on the intended network using its authorized deployment process; preserve its address/state and configured identity, relationships and usage dependencies. Do not deploy an empty replacement as an upgrade.
3. Deploy the rebuilt indexer and sponsor. SQLite schema version 5 adds poll tables. Rebuild projections from the upgrade height if events were indexed before the new schema decoder was installed. Sponsor default policy includes `answer_poll`; operators with explicit allowlists must add its ABI entry point.
4. Deploy the rebuilt web bundle and extension.
5. On testnet verify creation, answering from a second account, answer changes, a separate up/down reward vote, and closing. Check final on-chain totals and usage consumption before a production release.

No network deployment is performed by these source changes. The existing testnet deployment manifests are intentionally not relabeled as poll-enabled.
