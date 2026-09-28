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
2. Starting a conversation generates a fresh conversation signing wallet, a separate
   invitation signing wallet, a random one-time Olm account/prekey, and a random return
   delivery key. A signed, encrypted invitation contains the real identities and the
   conversation public material. It is posted to the shared invitation log without a
   recipient identifier. All browsers scan the same bounded pages locally.
3. Acceptance creates the recipient's own conversation wallet and independent Olm
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
Messaging starts after acceptance; there is no fallback to seed-derived encryption.
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

An outgoing request is locally saved before it is delivered. Show **Preparing request**
while reserving/allocating allowance, **Confirming request** after attempting publication,
and **Request sent** only after its exact packet is irreversible. Preparing the first
request can take several minutes; signing stops when the account is locked, switched,
or its browser closes. Navigating to another page within the unlocked app is supported.
Incoming requests have a separate approval section at the top of Messages.

Invitations have a signed seven-day lifetime. A funding or network delay longer than
five minutes must not invalidate them. Reject expired or future-dated requests, and
verify the signature, intended device, and block permissions as before. Updated clients
rescan the shared invitation log once to recover valid requests skipped by older clients;
existing chat IDs and ratchet state prevent duplicates.

Local state uses a device-generated, non-extractable WebCrypto AES key in IndexedDB,
combined with the account unlock secret. Account exports omit it. No seed-encrypted copy
of the ratchet or message history is retained. Storage failures stop the operation.

## Remaining metadata and future work

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
real usage, delivers/accepts a request, and verifies decrypted messages both ways. It never
uses a tester's seed or writes private material. It consumes testnet sponsor Mana and may
take several minutes per finality stage. This supplements the browser checks below.

Use two separate browser profiles and two test identities. Enable private messages
on each browser, send and accept a request, and exchange several messages both ways.
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
