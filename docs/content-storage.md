# Content off chain; protocol ledger on chain

## Longer posts (Chrome beta 0.7.6)

Hosted clients allow **100,000 characters per post or reply**. The website and
standalone panel show a character counter; their existing text field count also
applies to the browser connection/cross-post client. Poll wording retains its
separate 500-character limit, and private chat packets retain their own limits.

If text would exceed the 4 KiB publication envelope, the author uploads its UTF-8
bytes separately to R2. Private text is encrypted with a fresh media key before
upload. The normal `osp.envelope.content` gains an optional `text_ref` field (9),
a bounded versioned JSON descriptor containing the URL, stored size and SHA-256.
Private descriptors additionally carry the file key and nonce **inside the
already encrypted publication envelope**. No private key enters the public URL.

The content's `text` field contains a human-readable update message for older
clients. Current clients verify the post, open its authenticated envelope, then
fetch and verify the descriptor's complete text. They preserve media references,
selected recipients and original provenance fields. Failed or tampered downloads
show a retryable error; they do not silently substitute truncated text. Only
verified stored bytes have a bounded cache; private plaintext is not cached there.

The small publication envelope is uploaded through the existing content-reference
transport. Its chain representation remains 44 bytes. The contract's original
4 KiB envelope-size rule remains in force, and no contract deployment is needed.
The working R2 upload service already accepts these text bodies. Existing posts,
idempotency recovery, edits, revision history and audience checks retain their
existing ledger behavior. Feed previews use Read more; full views and edits keep
the complete story.

The optional content schema is client-only and is not interpreted by contracts.
Other clients can use the SDK's `storePostText` and `resolvePostText` helpers.

## Existing content storage

New Harbinger writes from the web app and extension upload content to the sponsor's
authenticated R2 service before signing a ledger transaction. A failed upload or
failed read-back aborts publication; there is no automatic inline fallback.

| Hosted content | Ledger data retained |
| --- | --- |
| Post and reply envelopes, including text and attachment descriptions | Author, IDs, versions, fingerprints, visibility, group/reply links |
| Poll questions and option labels | Committed wording fingerprint, option indices, closing time, ballots, counts |
| Direct messages and private messaging packets | Ciphertext fingerprint, routing, consent, sequence, grants, accounting |
| Profile documents, group/album descriptions and album captions | Identity/profile fingerprint, group ownership, members, revisions |
| Music titles, artists, descriptions and comment bodies | File fingerprint, access rules, prices, licenses, comment IDs and replies |
| Photos, artwork, voice, music and videos | File locations, sizes, fingerprints, usage/payments and access keys |

Friendships, follows, blocks, membership changes, key distribution, identity and
device authorization, lifecycle/moderation decisions, votes, influence and rewards
remain protocol operations. Keys used to read private content stay on devices;
only the existing sealed key distribution travels through the ledger. Content
encryption and recipient selection happen before hosting, using the existing
formats. This migration does not change which music metadata is public.

## Reference format v1

Binary body fields (`envelope`, `body`) contain a 44-byte reference: eight magic
bytes `OSPREF1\0`, a big-endian uint32 original byte length, and SHA-256 of the
original body. The digest commits to ciphertext for an encrypted body. Contracts
enforce the original size limits and use the original digest for message/post IDs,
idempotency checks and music-comment voting. Invitation bodies retain their 4168
byte padded representation off chain, while the transaction carries the reference.

String fields use `osp:content:v1:<decimal size>:<lowercase hex SHA-256>`. Profile
references address the original canonical Protobuf profile. Music references in
`title` address UTF-8 JSON containing only `title`, `artist`, `description`; the two
inline description fields are empty. Poll references in `question` address UTF-8
JSON containing only `question`, `options`; on-chain options are positional strings
`0`, `1`, etc. Option count and closing time are still contract-enforced, and the
wording commitment cannot change after creation. Hydration cannot replace ledger
fields such as author, prices, permissions, counts or closing time.

The resolver derives `/osp/<base64url chain ID without padding>/<identity contract>/<base64url digest with padding>`
under the deployment's configured public content base. This is the existing R2
object namespace. The reference itself contains no provider domain. Future mirrors
can serve those exact bytes without changing author signatures or content IDs.
This release configures one origin; automatic mirrors and storage rewards are deferred.

Content is limited to 16 KiB per referenced document; existing per-method limits
remain smaller where appropriate. Downloads are bounded, require HTTPS, omit
credentials/referrers, reject redirects, and verify size and digest before parsing
or decryption. JSON hydration copies only the named content fields. Verified bytes
have a bounded in-memory cache; failed downloads are retried on later requests.

## Deployment and compatibility

Follow `r2-media-testnet.md` for R2, CORS, sponsor, indexer and contract setup. Deploy
**both Publications and Messaging** using the workflow's `content-storage` choice.
Both advertise `content_reference_version = 1`; clients refuse content writes to
older contracts. Identity already accepts a profile URI and needs no new method.
The SDK exposes `createContentLoader` and `hydrateContent` for other clients; set
`ProtocolClient.contracts.contentLoader` to restore existing typed read shapes.

Set `OSP_CONTENT_PUBLIC_URL` on the indexer to the same base as the sponsor's
`OSP_MEDIA_R2_PUBLIC_URL`. It resolves content on API requests, not during ledger
ingestion. Its raw event log and projections retain the chain references, so an
outage never blocks synchronization, checkpoint hashing, or fork replay. Clients
also resolve references independently. Public profile name search resolves current
profile documents before matching.

Old inline records and old media chunks remain readable. Existing incomplete
legacy media reservations can finish using their original transport. The upgraded
contracts retain legacy ABI acceptance for older clients; this rollout changes all
new content writes through the updated apps, rather than erasing history or
forbidding arbitrary data in every possible chain transaction. Existing blocks
cannot be made smaller by changing the hosting architecture.

Activation still requires a configured R2 bucket/public domain and credentials,
service restarts, contract upgrades and deploying the web/extension builds. The
implementation alone does not activate or migrate the running testnet. Use
`node --import tsx scripts/verify-r2-media.ts --upload` with a test account to check
an encrypted upload, content-addressed reference lookup and local decryption.
