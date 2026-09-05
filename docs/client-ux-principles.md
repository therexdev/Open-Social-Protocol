# Client experience principles (web client and extension)

Derived from the project proposal (sections 5 and 8) and the roadmap (phases 2 and 3).
Both the reference web client and the browser extension must satisfy these.

## Experience principles

| Principle | Requirement |
| --- | --- |
| Invisible infrastructure | No seed phrase or Mana terminology in the default social journey. "Account", "friends", "post", "recovery contacts" instead of keys, nonces, RC. |
| Explicit consent | Never cross-publish or grant a site permission silently. Every publication needs a deliberate confirm action showing the audience. |
| Local privacy | Encryption, decryption and signing happen on the user's device; plaintext and secrets never leave it. |
| Portability | Exportable identity file, compatible recovery paths, replaceable RPC / indexer / sponsor endpoints in Settings. |
| Honest revocation | Removing a friend blocks future keys; it cannot erase prior copies. The UI says so when removing a friend. |
| Clear provenance | Injected/cross-posted content is labeled as Open Social Protocol content. |

## Primary journey (web client exit gate)

1. Open the web client. Create an account (generate identity locally, protect the vault with a
   passphrase; passkey-assisted unlock where WebAuthn PRF is available).
2. The client registers the identity on chain (sponsored when a sponsor is configured, otherwise
   self-pay) and publishes the encryption key.
3. Find people by address or profile name (indexer search) and send a friend request; accept
   incoming requests.
4. Compose a post; choose **Everyone** or **Friends** (friends-only posts are encrypted with the
   current audience epoch key and keys are distributed to friends).
5. Read the feed (public posts and decrypted friends-only posts), react and comment.
6. Recover the account from the exported identity file on another device; set up recovery
   contacts (guardians) in Settings.
7. Use the same identity from another compatible client (the extension).

## Extension journey (release gates)

1. Install the extension. Unlock or import the same identity (or create one).
2. The side panel shows the protocol feed and composer everywhere (generic sidebar).
3. The user optionally grants the Facebook host permission from the extension options page.
4. On facebook.com the extension adds a clearly labeled "Also publish to Open Social" control to
   the composer. Publishing requires an explicit confirmation surface (audience + permanence
   notice) rendered by the extension, not by the page.
5. Signing and encryption happen in the service worker; no private key material enters the page.
6. Every content-script message is validated (type, origin, tab, size, user gesture) before any
   privileged work.
7. Repeated retries cannot create duplicate Koinos posts (idempotency key + reconciliation).
8. Partial and unknown outcomes have deterministic recovery paths visible in the side panel.
9. The sidebar keeps working if feed insertion is disabled or the host DOM changes.
10. Protocol posts inserted into the host feed (optional, off by default) are labeled.

## Safety controls

Mute (client-only), block (protocol action), report export (local), content warnings, and
moderation-list subscriptions (community labels from the indexer) are part of the baseline.

## Telemetry

None by default. Any analytics must be opt-in and must never include plaintext, keys, audience
secrets or unredacted decrypted errors.
