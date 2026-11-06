# Open Social Chrome extension

Version 0.7.2 is a standalone protocol frontend in the Chrome side panel, plus
optional Facebook and X feed integration and composer cross-posting. It does not load the website
or a separately bundled website application. The Social switch and Open in tab
button are removed. See [release instructions](../../docs/chrome-extension-0.7.2.md).

## Build and install

From the repository root:

```sh
npm ci
npm run build -w packages/proto
npm run build -w packages/sdk
npm run build -w apps/extension
npm run zip -w apps/extension
```

Load `apps/extension/dist` unpacked through `chrome://extensions`. To update,
replace files in the existing unpacked folder and click Reload; keep the extension
installed to retain its ID, accounts and history. No backend deployment is needed.

## Independent interface

`src/sidepanel/App.tsx`, `ExtensionLayout.tsx` and `client.css` own the routes,
navigation and compact panel layout. Feature modules, services and vault code are
shared with `apps/web/src`; the website App, Layout, entry point and PWA are not
imported. The SDK/indexer are accessed directly in the extension, keeping formats,
encryption and access rules consistent with other protocol clients.

Feed, Post, Groups, Messages, Friends and Profile are the main navigation buttons.
More includes people search, activity, wallet, rewards, settings, browser
connections and unfinished browser posts. The client includes post revisions,
weighted voting, polls, reactions, comments, photos/albums, voice/video capture,
music, groups, profiles, messaging/browser linking and token transfers.

Providers remain mounted across navigation. Closing the panel stops recordings
and uploads; saved uploads can be resumed from Post. Microphone/camera permission
setup may open a small extension-owned permission tab.

## Accounts and trust boundaries

The full panel account remains encrypted in extension-origin IndexedDB `osp-web`,
store `vault`, key `osp.web.vault`. The former Social view's full account, drafts,
remembered sign-in and message history are reused in place. Signing/encryption for
full-panel actions run in the privileged panel. This identity never enters a
host content script or embedded feed card.

Host integrations share the separate worker vault (`osp.vault` in local Chrome storage)
and restricted device key. `osp.session` is session-only with trusted-context
storage access. Adapter settings, reading keys and `osp.crossposts` are preserved.

For a worker-only account, Welcome requires the same identity. An owner-mode vault
can be explicitly exported with its passphrase and copied into the full encrypted
vault. Device-only accounts need their original identity backup; a device key
cannot restore owner authority. Wrong identities are rejected and existing full
accounts are never overwritten. Failed account lookup does not offer new-account
creation until the saved account can be checked.

More → Browser connections manages the optional worker authorization. New
connections can explicitly copy the unlocked full identity. Renewal can use it
ephemerally after verifying account, key version, reading key and passphrase.
It preserves device/reading keys and drops the owner seed unless retention is
selected. Different connected/full identities are shown without being replaced.
The menu's Lock account and site connections action locks both sessions; their individual
auto-lock/settings remain separate.

Full-panel network preferences are initialized from worker settings only when
none exist. Existing preferences are preserved independently; review both sets
when switching networks.

## Facebook integration

Optional host permissions are granted in Browser connections or extension options.
Content scripts register dynamically only for granted origins. Revoking/disabling
access removes adapter UI/listeners. The panel works independently of host DOM.

The share checkbox defaults on, with a setting to disable that default. A trusted
Post action saves the attempt, adds `Join Me On Open Social: PROFILE-LINK` with
the separating space, waits for the editor update and activates Facebook Post
once. A bounded observer accepts only a new matching permalink or publication
success link. The worker checks account, tab, time window and canonical URL before
publishing Open Social with the Facebook link. Missing/ambiguous links leave a
recoverable draft under Post or More → Unfinished browser posts. Preparation
errors leave the editor intact.

Feed insertion anchors one card after every three native posts, preserves order
and repairs row replacement/recycling without collecting cards after the loading
suffix. Facebook's palette supplies a validated light/dark enum. Feed cards are
`src/embed/index.html` frames exposed only to granted Facebook and X origins; the panel
itself contains no embedded site.

Cards support weighted votes, polls, reactions, comments, verified avatars,
photos, audio and video. Host scripts receive IDs/sizing, never private plaintext
or keys. Narrow worker APIs bind actions to the frame and displayed root, validate
ancestry and derive actor/audience/recipients from chain-verified state. Writes
require a trusted interaction and unlocked authorized device. There is no generic
signing API or signing through postMessage; theme messages cannot transact.

Replies are persisted encrypted before signing, with stable idempotency keys for
unknown-outcome reconciliation. Archive manifests/chunks/fingerprints are verified.
Media uses verified attachment indexes, not caller-supplied keys or URLs. Lock
clears plaintext/players; background reads do not keep the worker unlocked. Poll
answers do not implicitly cast reward votes.

## X integration

X has independent site access, feed audience, feed visibility, default-checkbox
and profile-invitation settings in Browser connections. Existing enabled 0.6.0
X feed installs migrate to full integration. Fresh installs still require X access.
Cards use the same restricted worker identity and inline-action checks.
The actual tab origin determines which site's enablement applies; a card cannot
impersonate the other site via its hash or request payload.

The Home timeline locator identifies measured cells by tweet timestamp permalinks,
excluding quotes, suggestions and non-home pages. Cards are inserted after the
native article within its measurement wrappers, leaving the native transforms
unchanged. Recycled cells park cards by status ID until that tweet returns.
Switching For you/Following resets placement; leaving Home removes all cards.
Inline and modal X composers support the same default-on checkbox and Public/Friends
selection as Facebook. A trusted Post action saves the text, settles the selection
inside a Draft text leaf, and sends one plain-text paste event for the invitation.
It verifies the original text plus exactly one footer after the editor renders.
X does not use execCommand, replace editor DOM, or restore a stale selection.
Rejected/unexpected updates stop further insertion and show the original text
for recovery. The original draft is also retained in the existing saved queue. The adapter then checks X's native
submit state instead of assuming a fixed character limit. If the invitation makes
the draft invalid, it removes its added footer and leaves the draft for correction.
Only a new success-toast permalink or matching own-account timestamp permalink
completes the saved copy; unrelated users, navigation, quotes and old status IDs
are ignored. Ambiguous/missing results remain recoverable from Unfinished browser
posts. One automatic X publication is tracked at a time. Multi-post threads pause
with an explanation; unchecking Open Social leaves native posting available.

The worker binds the draft to account/tab/time, reserves signed-envelope space for
the canonical status URL and appends that URL to the Open Social text and external
reference. Public and Friends encryption/access use the existing protocol path.
Completion and retry reuse the persisted idempotency key. The content script can
only request feed identifiers, site preferences, X draft preparation and completion;
it cannot use Facebook methods, read keys or access generic signing APIs. Native X
media stays on X, reachable through the published link, as in Facebook cross-posts.

`smoke:x-feed` exercises the shipped classic script with a virtualizer fixture;
`X_SNAPSHOT` can replay anonymized row structure from a local capture. The same
card interaction browser suite accepts `TEST_HOST=x`. Captures/screenshots are
never committed or included in the release. Both adapters have unit coverage for
permission boundaries, private content and signed protocol actions.

## Validation

```sh
npm test -w apps/extension
npm run typecheck -w apps/extension
npm run build -w apps/extension
npm run smoke:client-browser -w apps/extension
npm run smoke:embed-browser -w apps/extension
npm run smoke:facebook-post -w apps/extension
npm ci --prefix apps/extension/scripts/fixtures/facebook-lexical --ignore-scripts
npm run smoke:facebook-lexical -w apps/extension
npm run smoke:facebook-scroll -w apps/extension
npm run smoke:x-feed -w apps/extension
npm run smoke:x-post -w apps/extension
npm ci --prefix apps/extension/scripts/fixtures/x-draft --ignore-scripts
npm run smoke:x-draft -w apps/extension
```

Build checks cover the MV3 manifest/CSP, classic content script, no-eval worker
startup and packaged panel/options/cards in fresh realms. They assert the bundled
website is absent. Tests cover migration, non-overwrite, authorization renewal,
routes/account gates, sender/device restrictions, replies/media, engagement,
cross-post idempotency and recovery. Shared frontend tests cover feature modules.

Browser checks use Playwright (`CHROMIUM_PATH` can select an installed executable;
`TEST_VIDEO` supplies an optional MP4). Panel checks exercise encrypted account
reuse/unlock, OSAT value, native navigation, recording, video preparation, profile
tabs, narrow layouts, settings, lock and messaging WASM under the shipped CSP.
Card/adapter checks cover interactions/media, themes, delayed publishing, footer
spacing, permalink matching, preferences, scroll and row recycling.

The Facebook Lexical regression reproduces the reported URL-ending draft against
real pinned rich-text and plain-text editors, including the extension's isolated
world. It checks committed paragraphs, unchanged original link nodes, native
submission, opt-out and settings changes, rejected/corrupt paste recovery and
retry without duplicate invitations. The previous simple editor fixture missed
Lexical dropping newlines from the old multiline insertText command.

The X Draft regression uses a real pinned Draft.js/React editor with committed
state assertions, URL decorations, mention entities, selections, paragraph blocks,
rejected/corrupt paste handling, native submission and stale-context recovery.
Those dependencies are isolated in the test fixture and never shipped.

Every automated network response is a fixture. Tests do not publish live
transactions or replace manual acceptance in an installed extension on signed-in
Facebook and X. Optional `FACEBOOK_SNAPSHOT` replays locally captured HTML with scripts
and external resources disabled; never commit or upload that private file.
