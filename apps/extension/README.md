# @osp/extension

Chrome (Manifest V3) extension for the Open Social Protocol: a key-isolated service worker, a side
panel with the protocol feed and composer (the generic sidebar that works on every site), an options
page, and an optional, clearly labeled Facebook cross-post adapter. Built with Vite 8, @crxjs/vite-plugin,
React 19 and `@osp/sdk`.

```sh
npm run build -w apps/extension   # tsc --noEmit + vite build (manifest, worker, side panel, options) + content scripts
npm test -w apps/extension        # vitest (jsdom)
npm run zip -w apps/extension     # apps/extension/dist.zip for store upload (node only, no extra deps)
npm run icons -w apps/extension   # regenerate public/icons/*.png (node only)
```

## Load unpacked

1. `npm run build -w apps/extension` (from the repository root).
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and pick `apps/extension/dist`.
3. Click the extension icon: the side panel opens (the action is bound to the side panel).
4. Create an account or import the identity file exported by the web client (same JSON format), then
   authorize this browser (see *Device authority*).
5. Optional: open the extension options (⚙ in the side panel) to enable the Facebook adapter.

Without `deployments/harbinger.json` (produced by the deploy-testnet workflow) the extension still
builds, installs and starts: the side panel reports the network as **not deployed** and stays in
read-only mode (no chain writes); the indexer and endpoints can still be configured in the options.

## Security model

| Boundary | Rule |
| --- | --- |
| Keys | Only the service worker ever holds secrets. Pages (side panel, options) and content scripts talk to it through `chrome.runtime.sendMessage`; they never receive key material or plaintext of other people's private posts beyond what they display. |
| Vault at rest | `chrome.storage.local["osp.vault"]` holds an SDK `VaultBlob` (scrypt + XChaCha20-Poly1305 under the passphrase). |
| Unlocked secrets | Memory + `chrome.storage.session` (trusted contexts only, never written to disk, cleared when the browser closes). Auto-lock via `chrome.alarms` (default 15 min of inactivity, configurable). |
| Device authority | By default this browser holds **only a device key** (`publish | react | comment | relationships`, 30-day expiry, authorized with `identity.authorize_device` signed by the owner key) plus the X25519 encryption secret needed to read friends-only posts. The identity seed is discarded after authorization unless the user opts to keep it. A device can never rotate keys, authorize devices, block or recover. Revocation happens from the web client. |
| Message validation | Every message is checked in order: object shape and 32 KiB size cap, `sender.id === chrome.runtime.id`, known type, source classification by origin (extension pages vs content scripts), then for content scripts: a real tab, top frame only, origin among the *granted* optional host permissions, only `crosspost.propose` and `feed.request`, per-tab rate limit, user gesture for proposals; finally a strict per-type payload schema that rejects unknown keys. Replies carry minimal data. |
| Content scripts | No static `content_scripts` in the manifest and no remotely hosted code. The Facebook adapter is registered with `chrome.scripting.registerContentScripts` only after the user grants the optional host permission from the options page, runs in the **isolated world**, and is unregistered (permission removed) when disabled or when the permission is revoked in `chrome://extensions`. |
| Publication consent | Nothing is published from a host page. A content-script proposal becomes a **draft**; publishing happens only from the side panel confirmation surface (audience + permanence notice, honest revocation notice for friends-only posts). |
| CSP | `script-src 'self'; object-src 'self'`. protobufjs (used by the SDK and koilib) normally generates encoders with `Function()`, which this CSP forbids; `src/shared/protobufNoEval.ts` installs interpreted encoders/decoders with byte-for-byte parity (tested against the generated code) and is the first import of the worker. |
| Telemetry | None. |

### Storage layout

| Key | Area | Content |
| --- | --- | --- |
| `osp.vault` | local | `VaultRecord { account, mode: "owner" \| "device", blob, device, keyVersion }` |
| `osp.session` | session | unlocked session (hex secrets, activity timestamp) |
| `osp.settings` | local | endpoints, payment preference, adapter toggles, auto-lock |
| `osp.crossposts` | local | cross-post records (drafts keep their text until the Koinos side succeeded) |
| `osp.keys.<account>` | local | audience epoch keys, AES-GCM encrypted under a key derived from the encryption secret |

## Cross-posting and reconciliation (spec sections 7 and 8)

`src/background/crosspost.ts` persists one `StoredCrossPost` per attempt and drives it with the SDK's pure
`transition` / `retryPlan` and the `Reconciler` lookup:

* the idempotency key is `idempotencyKey(author, attemptId)` with the attempt id persisted before anything is sent;
* `confirm` (side panel only) publishes; `TransactionOutcomeUnknownError` and network errors map to `koinosUnknown`;
  reverts and RPC rejections to `koinosFailed`; a duplicate-key revert resolves to the existing post;
* `retry` on an unknown outcome first calls `get_post_by_idempotency_key` through the `ProtocolClient`, then the
  indexer (matching the envelope's content hash on `/v1/accounts/:account/posts`); Koinos is never republished once a post id is known;
* the Facebook side is published by the user in Facebook's own UI: the proposal records that the submit control was
  activated (`hostRef` = composer URL), and the queue lets the user mark the host side posted/failed when needed;
* once both sides are known the signed proof manifest (`buildProofManifest` + `signProofManifest`, device key) is recorded with
  `record_cross_post` (best effort, retryable from the queue);
* a periodic alarm turns interrupted submissions into `unknown` and resolves unknown outcomes by lookup only.

The queue explains every state (`src/shared/queue.ts`) and exposes deterministic actions: Confirm, Retry, Reconcile,
Mark host posted/failed, Record proof, Discard. `reconcile_required` (conflicting facts) disables automatic retries.

## Adapter design and fixtures

`src/content/adapter.ts` holds host-agnostic helpers: a `ComposerAdapter` interface (find composers / textbox / footer /
submit control), one-control-per-dialog injection (`data-osp-control`), a capture-phase submit hook that reads **only**
the textbox `textContent`, a toast, and a bounded `MutationObserver` (childList + subtree on `document.body`, batched with
`requestAnimationFrame`, disconnected after 60 s without mutations, reconnected on focus/visibility).

`src/content/facebookAdapter.ts` implements the Facebook adapter with role-based selectors
(`div[role="dialog"]` containing `[contenteditable="true"][role="textbox"]`; submit = `[aria-label]` matching
`/^(post|publish)$/i`, else the last enabled button in the footer). When the checkbox is on and the user activates the
submit control it sends `{ type: "crosspost.propose", payload: { hostSite, text, attemptId, url, submitted, userGesture } }`
and shows "Sent to Open Social - confirm in the side panel". If the selectors fail nothing is injected and nothing breaks:
the side panel composer keeps working. `src/content/feedCards.ts` (off by default) inserts one labeled container
"Open Social Protocol posts" (text only, up to 5 public posts) at the top of `[role="feed"]` or `main`.

Fixtures under `src/content/__fixtures__/` (`composer.html`, `no-composer.html`) drive `src/content/adapter.test.ts`:
exactly one control is injected, the submit hook reads the composer text only, a page without a composer gets nothing.

## Tests

`src/test/chromeMock.ts` provides an in-memory `chrome` (runtime messaging with sender simulation, storage areas, alarms,
permissions, scripting registration, action badge, side panel, tabs). Suites:

* `src/background/messages.test.ts` - router validation (sender id, origin, types, size, gesture, frames, rate limit);
* `src/background/crosspost.test.ts` - orchestrator persistence and transitions incl. the `koinosUnknown` lookup path, plus an
  end-to-end run through the service worker with a fake koilib provider (`ProtocolClient` reads/writes mocked);
* `src/background/vault.test.ts` - device-key policy (owner seed not persisted unless opted in), auto-lock, import;
* `src/content/adapter.test.ts` - adapter detection against the fixtures, observer bounds, labeled feed cards;
* `src/shared/protobufNoEval.test.ts` - byte parity of the no-eval protobuf runtime with protobufjs' generated code.

## Release gates (docs/client-ux-principles.md, "Extension journey")

| Gate | Where |
| --- | --- |
| 1. Install; unlock/import/create the same identity | `src/sidepanel/Onboarding.tsx`, `src/background/vault.ts` (identity file = SDK `exportIdentity` format) |
| 2. Feed and composer everywhere (generic sidebar) | side panel (`Feed.tsx`, `Composer.tsx`), "Share current page" via `activeTab` |
| 3. Facebook permission granted from the options page | `src/options/App.tsx` (`chrome.permissions.request`) -> `adapter.enable` -> `registerContentScripts` |
| 4. Labeled control + extension-rendered confirmation (audience + permanence) | `src/content/facebookAdapter.ts`, `ConfirmSheet` in `Composer.tsx` / `Queue.tsx` |
| 5. Signing/encryption in the worker, no keys in pages | `src/background/*`; pages use `src/shared/rpc.ts` only |
| 6. Every content-script message validated (type, origin, tab, size, gesture) | `src/background/messages.ts` + tests |
| 7. Retries cannot duplicate posts | idempotency key from persisted attempt id; `retryPlan`; duplicate-key resolution |
| 8. Partial/unknown outcomes have visible deterministic recovery | queue explanations/actions in `src/shared/queue.ts`, `Queue.tsx` |
| 9. Sidebar keeps working when insertion is off or the host DOM changes | adapter failures are contained; side panel independent |
| 10. Inserted host-feed content is labeled | `src/content/feedCards.ts` ("Open Social Protocol posts", off by default) |

Experience principles: no seed/Mana wording in the default journey ("account", "friends", "post"); explicit consent
for every publication and every site permission; local privacy (all crypto in the worker); portability (identity
file, endpoints in options); honest revocation text on friends-only confirmations; provenance labels on injected content.
