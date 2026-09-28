# Private messaging v2 (testnet)

## Security boundary

The account seed recovers signing identities, including separately derived conversation
wallets. It MUST NOT derive messaging encryption keys, ratchet state, or the key protecting
local chat history. A leaked seed alone must not decrypt previously recorded traffic.
An unlocked/compromised device, saved history, or an earlier device backup is a different
threat. Browser storage and JavaScript cannot promise forensic secure deletion.

Use the Olm Double Ratchet from Matrix's Rust vodozemac through the pinned
`@towns-protocol/vodozemac` WASM bindings, rather than implementing a ratchet locally.
This is a classical ratchet, not Signal wire compatibility or post-quantum encryption.
The integration is testnet software; upstream review does not constitute an audit of OSP.

## Private setup

1. Each browser generates an independent random delivery key and publishes its public key
   in an owner-authorized device directory. No conversation wallet is in that directory.
2. Starting a conversation generates a fresh conversation signing wallet,
   a random one-time Olm account/prekey, and a random return
   delivery key. A signed, encrypted invitation contains the real identities and the
   conversation public material. It is posted to the shared invitation log without a
   recipient identifier. The conversation wallet also signs its introduction, so
   setup packets and subsequent traffic from that alias are publicly linkable,
   without exposing its profile address. All browsers scan the same bounded pages locally.
3. Automatic acceptance (or explicit approval when opted out) creates the recipient's own conversation wallet and independent Olm
   session using the invitation's one-time prekey. The authenticated acceptance travels
   through the same log encrypted to the invitation's return key. It contains the
   recipient's alias, not in the public routing fields.
4. The requester consumes the one-time prekey, saves the ratchet, and removes the setup
   account and return key. Subsequent packets are addressed only by conversation wallets.
   Mutual consent is enforced by a two-party channel registration; closing prevents
   new packets. Profile blocks are checked locally because exposing the profile pair
   to an on-chain block check would defeat this privacy boundary.

Per-conversation prekeys are carried on-chain **inside the encrypted invitation**.
No publicly attributable prekey-claim transaction links the invitation to its recipient.
The first message is saved immediately in a separately locked, doubly encrypted browser
queue. Setup and delivery run in the background; the first key exchange still requires
the recipient's enabled, unlocked browser to come online. No user acceptance click is
needed by default. Disabling automatic connections restores manual approval. Blocks are
checked before accepting and before sending. There is no fallback to seed-derived or
static delivery-key encryption for message text.
Each browser owns its own sessions. Importing an account recovery file on another browser
does not import conversations or chat history.

## Usage and sponsorship

New aliases receive no free allowance. A registered profile reserves a small batch of
existing token usage units with `reserve_private_usage`. The token contract consumes the
units immediately, using its existing five-day recharge/locking rules. Unspent prepaid
units do not recharge separately. This is prepayment, not a second free-credit bucket.

The reservation adds to a shared pool belonging to a chosen sponsor. An off-chain,
owner-signed allocation request binds that reservation to one alias. The sponsor persists
an idempotent assignment and allocates from its pool in a separate transaction, using an
unrelated random grant id. The contract enforces pool conservation and packet debits;
the sponsor enforces ownership and one redemption per reservation. Any independently
operated sponsor may implement the same service. It is not a message relay.

The sponsor necessarily knows the reservation-to-alias mapping and can withhold or
misallocate reserved credits; this pilot is not anonymous from the sponsor. The chain
sees deposits and allocations, and timing/amount correlation is possible, particularly
with a small anonymity set. No deterministic reservation id or profile signature may be
included in an alias allocation, channel registration, or message transaction.

## Durable delivery

Persist ratchet advancement, plaintext history, and the exact outgoing ciphertext together
before submission. Retries use the same packet id and bytes. Receive only after verifying
the chain commitment; persist the advanced ratchet and local history atomically. Never
advance state on authentication failure, clear pending state on an uncertain broadcast,
or reconstruct/reuse a message key. Cross-tab operations require an exclusive browser lock.

Sending saves text to the encrypted queue immediately, independently of the main sync
lock and slow network reads. The UI permits composing while connecting. The queue is
consumed into one atomic ratchet/outbox/history commit, then its entry is removed;
message IDs deduplicate a crash between these writes. Closing cancels pending sends;
both local and remote closure retain unsent text as **Not sent**. Simultaneous introductions select
one conversation deterministically before either browser advances its message ratchet.

Both participants reuse their conversation allowance for introductions and channel
consent. Where the peer's consent permits it, channel opening and the first packet
share one transaction. A cold connection and first message require two four-unit
reservations and seven transactions (including sponsor grants), rather than four
reservations and eleven transactions. Enabling browser devices is a separate one-time
step. Connected conversations need a single transaction per message while allowance
remains. Automatic incoming setup spends the recipient's usage credits; the privacy
settings explain this and provide an opt-out. Repeated introductions do not create
multiple active conversations for the same peer.

By default, an idle enabled browser prepares one unused conversation wallet with four
credits. Both peers can then complete a new conversation and its first message in three
transactions. Claiming the spare and saving the conversation are serialized with the
same browser lock; reloads reuse the saved reservation. Only one spare is prepared at a
time. The privacy settings explain the prepayment and let users disable it without
losing already prepaid credits. Background preparation backs off on errors.

On Harbinger, authenticated packets can be processed at inclusion and remain provisional
until irreversibility; allowance grants still require three confirmations. Other networks
retain full irreversibility. Old sponsors still require full finality for allowance; see below. Signing
stops when the account is locked, switched, or its browser closes. Navigating to another
page within the unlocked app is supported, including while the tab is hidden.

When automatic connections are disabled, incoming requests have a separate approval
section at the top of Messages. The default flow is choose a person, type, and send.

Invitations have a signed seven-day lifetime. A funding or network delay longer than
five minutes must not invalidate them. Reject expired or future-dated requests, and
verify the signature, intended device, and block permissions as before. Updated clients
rescan the shared invitation log once to recover valid requests skipped by older clients;
existing chat IDs and ratchet state prevent duplicates.

Local state uses a device-generated, non-extractable WebCrypto AES key in IndexedDB,
combined with the account unlock secret. Account exports omit it. No seed-encrypted copy
of the ratchet or message history is retained. Storage failures stop the operation.

## Remaining metadata and future work

### September 28 delivery reliability release

This release is additive and preserves the existing contracts, device keys, sessions,
and history. It does **not** implement asynchronous initial key agreement or linked-device
delivery. Those must not be advertised as available merely because established chats
can receive messages after coming back online.

- The sponsor verifies the owner proof and persists an idempotent assignment before
  acknowledging a pending grant. HTTP waiting is bounded to 1.5 seconds **after the
  validation RPCs**, independent of the serialized inclusion wait. In-flight retries
  join one job, and the queue is capped at 32 jobs. A pending response is not credit:
  the browser still checks the on-chain allowance and retries the same saved reservation.
  A process restart can lose an in-memory job, but cannot lose/rebind its durable
  assignment. Client retry recovers it. Payer nonce ordering remains enforced.
- Alias packet submission returns after broadcast instead of waiting for an inclusion
  receipt while holding the browser's messaging lock. The next packet for that alias
  stays blocked until its predecessor's commitment is read on-chain. Profile reservations
  still hold the shared account submission queue through inclusion.
- Inbox processing precedes sending/refilling, and signed sponsor discovery is reused
  for up to 60 seconds. An interrupted response body is classified as a transport
  failure, including interruption after HTTP headers arrive.
- Closing archives queued plaintext as **Not sent** before removing queue entries.
  A crash between those writes is deduplicated by message ID. Failed sync reads no
  longer replace the visible inbox with an empty, disabled snapshot.
- Close notices reuse the conversation's already funded alias. Each alias still has
  only one unobserved transaction at a time. On testnet the sender's closing badge can
  finish at inclusion, while exact ciphertext and channel reconciliation continue
  through finality. Receiving ratchet keys are not deleted on a reversible remote close.
- The UI distinguishes **Queued on this browser**, **Submitted**, and **On chain**.
  None is a read receipt. Multiple registered browsers show a clear notice that their
  histories are independent.

### Automatic inbox updates (2026-09-28)

The `2026-09-28-messaging-live-updates` release adds a recipient-free long poll at
`GET /v2/private/updates`. Its opaque cursor changes when the indexed block identity
changes, including same-height forks and rollbacks. It is only a wakeup signal:
clients still fetch ciphertext and verify chain commitments. It exposes no account,
device, or conversation subscription. The server uses one shared 500 ms check of its
local checkpoint, a 20-second response deadline, disconnect cleanup, and at most 256
waiting requests. At capacity it asks clients to back off. The normal indexer poll
interval remains two seconds; there is no extra blockchain poll per subscriber.

Unlocked messaging browsers reconnect automatically, suppress transport-only watch
errors, and keep normal two/eight-second polling as a fallback. Old indexers can still
serve packets. Returning to the app or reconnecting the network also triggers sync.
Wakeups arriving during a sync are coalesced into follow-up work rather than discarded;
each caller waits at most two passes, with further work scheduled separately.

An exact, already verified provisional packet is cached in memory (bounded to 1024
entries) rather than reread through RPC on every pass. Changed records always get a
fresh check. Every final cursor advancement rechecks the commitment, so cached
provisional data cannot authorize skipping an unverified final record. Unchanged
invitations and messages no longer rewrite the whole encrypted history per row.
New receiving ratchets/history still commit atomically before text is displayed.
Existing conversations receive ahead of slower new-channel preparation, and received
text is displayed before unrelated background work completes.

The visible conversation follows incoming messages only while near the bottom.
Reading older messages preserves the scroll position and offers a new-message jump
button. This is not a read receipt or automatic phone/desktop synchronization.

Deploy the updated indexer and frontend; the sponsor and contracts are unchanged.
`npm run verify:private-messaging` now checks the indexer `privateUpdates: 1` feature
and the wakeup endpoint in addition to the existing protocol checks.

### Next protocol milestone: offline first messages and linked devices

The required behavior is that a sender can establish a session and post the first
ciphertext while the recipient is offline, using authenticated prepublished device
prekeys. The recipient must generate and retain its own secret keys. Sending or deriving
those secrets on the sender's device is not an acceptable shortcut. A public one-time
prekey claim must not silently introduce a direct profile-to-conversation-alias link;
fallback/reused prekeys must not silently weaken the stated forward-secrecy boundary.
The prekey lifecycle and routing design need explicit conformance tests before rollout.

Linked devices require independent ratchets, authenticated device enrollment/revocation,
and separate encrypted copies to the recipient's devices and the sender's other devices.
Copying a live ratchet between independently sending devices risks state/key reuse.
Existing history transfer must be explicitly authorized from a device that still has it;
account-seed recovery alone must not decrypt old messages. Any new format must coexist
with current browser-local sessions during a staggered upgrade.

Acceptance gates include: recipient offline during first send; sender offline before
receipt; duplicate/reordered packets; simultaneous starts; exhausted/revoked prekeys;
two devices sending concurrently; device removal during delivery; interrupted history
transfer; and reorgs without double charging, lost drafts, or repeated ratchet advancement.

Conversation aliases, ciphertext, timing, and sizes remain permanent on-chain. Endpoint
operators can correlate requests and IPs. Contacts know whom they are talking to. Full
device compromise can reveal local identity mappings and saved history. Post-quantum
protection, secure device transfer, optional backups, relay transport, and relay incentives
are separate upgrades. The protocol and implementation must not claim complete anonymity,
retroactive protection, or invulnerability to future cryptanalysis.

## References

- https://github.com/matrix-org/vodozemac
- https://github.com/towns-protocol/vodozemac-bindings
- https://signal.org/docs/specifications/doubleratchet/
- https://docs.koinos.io/developers/payer-payee/

## Testnet rollout

The source branch is `codex/private-messaging-v2`. Deploy the contract and services
before publishing the web build. This update does not need token-policy changes,
new profile identities, or migration of testnet message history. The previous
messaging entry points remain isolated for older clients; this web client uses v2 only.

1. Run the existing GitHub **deploy-testnet** workflow on this branch, network
   `harbinger`, with `dry_run=false` and `force=false`. It uses the repository's
   deployment secrets, skips unchanged contract bytecode, and commits the updated
   deployment manifest back to this branch. The deployment verifier now requires
   `messaging.get_private_status.version === 2`.
2. On the Vultr server, stop `osp-indexer` and `osp-sponsor`, and back up their SQLite
   files together with any `-wal`/`-shm` files. Paths are configured through
   `OSP_INDEXER_DB`/`OSP_SPONSOR_DB` (defaults are `data/indexer-harbinger.sqlite`
   and `data/sponsor-harbinger.sqlite`, relative to each process working directory).
   Retain the sponsor database: it prevents allocating the same reservation twice.
   Do not roll it back after issuing grants or run several independent databases
   against one sponsor identity.
3. With a clean checkout, update and build the services:

   ```bash
   cd /home/linuxuser/Open-Social-Protocol
   git fetch origin
   git switch codex/private-messaging-v2
   git pull --ff-only origin codex/private-messaging-v2
   npm ci --no-audit --no-fund
   npm run build -w packages/proto -w packages/sdk -w apps/indexer -w apps/sponsor
   ```

   Restart the indexer normally. The schema migration to v4 is additive; existing
   profiles, posts, and token activity remain intact. Upgrade the indexer before
   clients send v2 packets so it starts decoding the new events immediately.
4. If `OSP_SPONSOR_ALLOWLIST` is explicitly configured in PM2, append the five new
   user methods (or use the updated default policy):
   `messaging:set_private_device`, `messaging:reserve_private_usage`,
   `messaging:open_private_channel`, `messaging:close_private_channel`, and
   `messaging:post_private_packet`. **Do not include `allocate_private_usage`:**
   that operation is generated internally after owner-proof verification.
   Restart the sponsor with its existing key, database path, and other settings,
   then `pm2 save`. Sponsor startup refreshes its on-chain advertised policy.
5. Run the read-only readiness check from the updated checkout:

   ```bash
   npm run verify:private-messaging
   ```

   This checks the live chain, caught-up indexer, shared invitation endpoint,
   sponsor feature version, signed discovery, and method policy. It spends no Mana.
6. Run the existing **deploy-web** workflow on the same branch after readiness
   passes, or deploy the resulting `apps/web/dist` using the normal Hostinger
   process. Include the `.wasm` asset, `.htaccess`, and `licenses/` directory.
   The PWA cache includes the encryption module. Accept the new app version in
   installed PWAs before testing.

### Two-browser acceptance test

An opt-in live integration journey exercises the actual web messaging service against
the deployed Harbinger contracts, sponsor, and indexer:

```bash
npm run test:private-messaging:testnet -- --execute
```

It creates two disposable test identities, enables their devices, reserves and allocates
real usage, automatically connects, and verifies decrypted messages both ways. It never
uses a tester's seed or writes private material. It consumes testnet sponsor Mana.
Add `--warm` to wait for the prepared allowances before measuring first-message delivery.
The script reports local-save and recipient-decryption timing separately.

Use two separate browser profiles and two test identities. Enable private messages
on each browser, choose a person, type the first message, and send. Verify that the
recipient connects without approval, then exchange several messages both ways.
Verify the following before bringing in the wider tester group:

- Pending messages appear immediately and continue sending after navigating away.
- Reload after sending, including an interrupted connection: delivery resumes once,
  with no duplicate history or replacement ciphertext.
- Two tabs can send concurrently without losing or reusing session state.
- Locking immediately hides history and prevents new signatures until unlock.
- A seed/account-file import in a third browser has no old conversations or history.
- Closing a conversation prevents new on-chain packets; creating another request
  uses new aliases and a new session.
- Usage reservations reduce existing profile capacity, and aliases receive no free
  balance merely by being created. Inspect packet/channel transactions: neither
  profile address is a public participant or signer there.
- The sponsor can still correlate its allocation records. These tests establish
  functionality, not anonymity from infrastructure operators or a security audit.

### Local validation, 2026-09-28

The SDK, all eight contract suites, indexer, sponsor, web, extension, and deployment
script suites passed after updating the new schema/policy expectations. The
release-WASM bootstrap passed 62 calls through actual generated dispatchers.
Type checks and production builds passed. Specific cases cover owner-proof
verification, finite usage pools, mutual consent, ciphertext commitment checking,
out-of-order ratcheting, replay rejection, persistence failure, concurrent sends,
unknown broadcast outcomes, finality, lock, reload, and seed-only recovery.

A production-bundled WebKit check exercised Olm encryption/decryption, IndexedDB
persistence of a non-extractable CryptoKey, real Web Locks across two tabs, and reload.
Mobile/desktop UI renders were checked in light and dark mode. This is browser-engine
coverage, not a physical iPhone test. Network behavior in the automated conversation
tests uses a controlled chain/indexer; live two-browser acceptance is a separate gate.

At preparation time the live indexer and sponsor did not advertise v2; the direct
RPC readiness request timed out from this environment. No contract or hosted service
has been deployed by this change. Deployment credentials and Vultr access are not
available in this workspace.

### Request cancellation and setup recovery

The messaging-lifecycle web release fixes cancellation before a shared channel exists.
It sends a signed `close` control statement inside the existing fixed-size encrypted
invitation envelope to each registered peer browser. The public packet has no peer
profile address. Established alias channels are also closed on-chain. This uses the
existing v2 contract, sponsor, and indexer; no redeployment is needed.

Local closure deletes setup and ratchet secrets and removes queued chat packets. The
close notice remains durable until confirmed, and the UI distinguishes local closure
from pending remote notification. It checks the request ID and authenticated peer, so
a late cancellation cannot close a newer conversation. Authenticated tombstones suppress
invitations that arrive after cancellation. Previously closed local records queue a
repair notice, and browsers upgrading later rescan the invitation log once to recover
close notices skipped by older clients. Both browsers must install the web update.

Sending, receiving, and closing now recover independently from network errors.
Allowance reservation, finality (remaining blocks), sponsor allocation, and connection
progress are visible, with errors attached to the affected request. Setup still needs
network confirmation and the relevant unlocked browsers; this does not make testnet
finality instantaneous. Cancellation consumes private usage for the encrypted notice.

Use `npm run test:private-messaging:testnet -- --execute --lifecycle` to extend the
disposable-account live journey with cancellation before acceptance, a new request in
the reverse direction, bidirectional messages, and closure of an established channel.

### Faster Harbinger delivery and background connection

The `2026-09-28-messaging-fast-testnet` web release continues polling while an
unlocked browser tab is hidden. Previously visibility stopped polling and could
leave the peer waiting indefinitely. Pending work polls every two seconds; idle
messaging polls every eight seconds; the visible Messages page also polls every two
seconds in the send-first release. Browser suspension can still delay work,
and locking still stops signing and hides private state.

The `2026-09-28-messaging-send-first` frontend processes authenticated Harbinger
invitations, acceptances, and messages at inclusion, retaining them as provisional.
It prepares one conversation allowance ahead of time when idle. The sponsor permits
private allowance assignment after three confirmations and advertises this in
its signed discovery policy as `privateUsageConfirmations: 3`. The web client
uses the shorter allowance wait only when the sponsor advertises that policy.
Other networks continue requiring full irreversibility. The earlier fast-confirmation rollout changed client and sponsor policy, not
consensus or contracts. Its sponsor health endpoint reports
`messagingFastConfirmation: 1`. The send-first release requires a frontend update
only when that sponsor version is already running.

Early confirmation is provisional. A testnet reorganization can remove packets
or allowance grants. The sender retains exact ciphertext and packet IDs until
irreversibility and rebroadcasts missing packets without re-encrypting. Receivers
retain authenticated message IDs and ciphertext hashes, rescan the reversible
suffix, and never roll back consumed ratchet keys. Final cursors advance only
over irreversible packets. A missing latest allowance grant retries its saved
reservation rather than creating another charge. Exhausted grants that still
exist require a new reservation. Owner proofs, idempotent sponsor assignment,
finite pool limits, and transaction nonce ordering remain enforced.

This is a testnet latency policy, not a claim of identical settlement safety.
The sponsor accepts reorganization exposure when assigning from a provisional
reservation; deep reorgs spanning multiple allowance refills may need recovery.
Private message text can remain in local history after its chain packet is
orphaned. Remote closures still wait for irreversibility before deleting ratchet
secrets. This policy should not be carried to a real-value network without a
separate review.

Consecutive messages can progress while earlier ciphertext awaits finality.
`Sent · confirming` means the packet was observed on-chain, not that the recipient
read it. Reservation submission and allocation have independent retry clocks so
successful confirmation does not impose another twenty-second retry delay. Each
sync pass reuses one conservative chain head instead of reading it separately
for every queued packet. Setup progress excludes already-confirmed control packets
that remain saved only for finality and recovery.

Regression coverage includes hidden-tab polling, locking, packet-inclusion and
three-confirmation allowance boundaries, strict non-Harbinger finality, burst delivery, reload, replacement
sequences, unchanged-ciphertext rebroadcast, and orphaned allowance recovery.

### Send-first validation (2026-09-28)

Disposable-account live tests against the deployed Harbinger contracts, public sponsor,
and public indexer completed automatic setup and bidirectional decryption without
manual request acceptance. The final run saved locally in under 1 ms, observed the
prepared first message in 54 seconds, and observed the reply in 25 seconds. Initial
allowance preparation took another 51 seconds in the background. These are environment
measurements, not delivery guarantees; the test polls every five seconds and uses a
pooled HTTP transport. Blockchain delivery remains substantially slower than local UI
updates. No relay, static-key message fallback, contract update, or sponsor redeployment
is introduced by this release.

Automated regression coverage includes automatic and opt-out approval, metered batching,
prepayment reuse, simultaneous introductions, encrypted queues during slow RPC calls,
two-tab sends, failed queue cleanup, failed signing, merge recovery, cancellation, blocks,
reorganizations, and vault deletion. Prepared-allowance replenishment pauses for a minute
after chat activity so it does not compete with replies. Pending badges exclude observed
messages and control packets retained only for recovery.

### Linked browsers (2026-09-28)

The linked-messaging-browsers frontend adds an explicit **Linked browsers** flow.
Enable messages on both browsers, start Link on one, compare the 64-bit invitation
code on both screens, and approve the matching request on the other. Automatic
conversation acceptance NEVER approves a device link. Simultaneous link requests
converge to one request and still require approval. An account seed alone does not
restore history or silently enroll a browser into history sharing.

An approved link uses its own Olm session over the existing v2 on-chain transport.
Only whitelisted conversation metadata and readable history records are copied;
no live ratchet, pickle key, signing secret, delivery secret, or one-time setup is
exported. Copies are encrypted in transit and saved under the receiving browser's
own encrypted store. This deliberately creates another readable history copy on
an approved device: compromising that unlocked device can expose copied history.
It does not promise that saved plaintext history can never be exposed.

History sync batches small records and splits long records into hash-checked parts.
The batch and packet IDs are persisted before encryption; advanced ratchets, exact
ciphertext, and delivery records commit together. Retries resume the same packet,
including after a crash between parts. Logical message IDs merge duplicate copies
and converge state updates without repeated echo traffic. Newer records precede
older history. Closures propagate across linked browsers, including a mirrored-only
thread closed on the phone, while preserving already saved text.

Updated peers can deliver through independent sessions for every registered device
pair, grouped into one logical conversation. Secondary-device setup does not block
the primary message; its copy job remains durable until the target can connect.
Routing capability is negotiated through optional authenticated invitation/acceptance
fields; existing text-only sessions remain readable. A browser upgrade does not
replace or clear local messaging storage. Device removal stops future copies after
the directory check; delivery-key changes invalidate a pinned history link. Re-enabling
a revoked browser requires a new approved link. Unlinking/removal cannot erase copies
already delivered. All additional on-chain copies consume the existing usage allowance.

No relay, new contract, sponsor policy change, or backend redeployment is required
for this frontend release. Both linked browsers need the new frontend. Initial
linking and first-time device-pair connection still require both relevant browsers
to be online and unlocked once. After that, ciphertext can wait on-chain for an
offline recipient. Browser suspension can pause unsent work; this is not a native
background push service. Future offline prekey setup remains a separate upgrade.

Validation includes four independent browser stores, explicit approval with auto-connect
on, old-history copy, offline catch-up, Unicode multipart history, interrupted batch
recovery, independent phone replies, revocation/re-enrollment, unlinking, simultaneous
link requests, duplicate suppression, and linked conversation closure. Run the opt-in
live journey with `npm run test:private-messaging:testnet -- --execute --devices` to
exercise seed-only isolation, linking, history copy, and a phone reply using disposable
test identities against the deployed testnet.
