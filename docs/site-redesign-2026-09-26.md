# Open Social website redesign and PWA — 2026-09-26

## Delivered behavior

- Real nickname discovery at `/people` and in Friends. Matching supports partial names,
  capitalization, accents and Unicode normalization; duplicate nicknames retain separate
  account addresses. Late results cannot overwrite a newer query. Profile editing explains
  that the display name is the searchable nickname.
- Native `/v1/people` indexer endpoint derives names from current inline profile documents,
  so edits and projection replay require no database or contract migration. The original
  address-prefix endpoint keeps its existing behavior. Older servers work immediately:
  the web client searches their public profile directory and splits full address-prefix
  buckets rather than silently stopping at 100 accounts. Directory requests are shared,
  cached for 30 seconds and bounded; an incomplete traversal reports an explicit error.
- Desktop sidebar, responsive content/secondary rail, mobile bottom navigation and More
  menu. Your profile opens the current account; `/me` resumes onboarding/unlock when needed.
  Post is removed from navigation. New post remains on the feed and your profile.
- A coherent light/dark design: original vector mark, matching icon set, deterministic
  account avatars, profile cover and statistics, updated post cards, forms, messages,
  dialogs, loading placeholders and onboarding. Extension 0.1.4 uses the same post styling.
- Mobile horizontal gestures switch feed scopes and main tabs. Controls, text inputs,
  vertical scrolling and browser-edge gestures are excluded. Segmented tabs also support
  arrow/Home/End keys. Motion respects the reduced-motion setting. Loaded feed panels remain
  mounted between scope changes; locking or switching accounts discards them. Refreshes keep
  existing posts on screen.
- Public `/about` explains the value proposition, account portability, the protocol versus
  its website/plugin, Facebook limitations, privacy and retained old reading keys in plain
  English. It does not imply that public copies can be erased or that Facebook is controlled
  by Open Social.
- PWA manifest, regular/maskable/Apple icons, static-only service worker and install controls.
  Offline deep links open the application shell; reading fresh content or publishing still
  requires a connection. No offline publishing queue. Static cache excludes API responses,
  posts, messages, external media, keys, writes and requests with query strings. Existing
  encrypted vault storage is unchanged. Updates require an explicit reload confirmation;
  other open tabs retain their work. Old caches are retained while other tabs can need them.

## Verification

- `npm run build:all` and `npm test` passed: 840 tests across all workspaces and deployment
  scripts; 2 opt-in live-network tests skipped. Web suite: 120 passing tests.
- Typechecks passed for web, SDK/build, indexer and extension. Packaged extension worker,
  side-panel/options/embedded-post and Facebook adapter smoke checks passed under MV3 CSP.
- Added coverage for Unicode/duplicate/malformed nickname documents, native and legacy search,
  complete legacy-page traversal, rename freshness, stale-query responses, profile/About routes,
  removal of Post navigation, repeated feed switches, lock invalidation, swipe exclusions,
  keyboard navigation and PWA cache/update/offline behavior.
- A read-only call against `social-api.usekoinos.com` returned 13 public profiles. A real
  registered nickname searched with different capitalization returned the expected account
  through the compatibility path. No accounts, posts or relationships were changed.
- Production manifest icon sizes and maskable background, worker syntax and all precache file
  paths were verified. The release ZIP contains the production app at its root.
- Browser visual acceptance remains unverified: the available cloud browser rejected the
  workspace preview at `http://127.0.0.1:4188` with `ERR_BLOCKED_BY_CLIENT`. DOM tests and
  packaged smoke checks do not establish real mobile gesture feel, actual home-screen
  installation, or authenticated Facebook appearance. No claim of those checks is made.

## Release configuration correction — extension 0.1.5

The original redesign ZIPs omitted the live service defaults. The committed Harbinger
deployment had empty `indexers` and `sponsors` arrays, and the release build did not supply
environment overrides. The website therefore could not load feeds/profiles; browser
authorization in the extension tried the account's own Mana without contacting a sponsor.
The previous statement that these ZIPs included the existing endpoints was incorrect.
Earlier tests injected service URLs and did not catch the packaging defect.

The deployment now supplies `https://social-api.usekoinos.com` and
`https://social-sponsor.usekoinos.com`. Fresh installs and saved empty overrides inherit
them. Explicit custom endpoints/payment preferences are preserved, and Harbinger defaults
do not leak into other networks. No contract or transaction behavior changes were needed.
The extension manifest and UI version now both come from package version 0.1.5.

Verification of this correction:

- Added packaged-build checks that failed against both original ZIP builds before the fix.
  The web check boots the actual compiled app with saved empty overrides, exercises nickname
  search and Settings, and asserts effective services. The extension check exercises its
  compiled worker settings for both fresh and saved empty overrides. Neither injects URLs.
- Rebuilt with empty URL environment overrides: both packaged checks pass. Web and extension
  typechecks pass, with 121 web and 89 extension tests passing; 2 opt-in live tests skipped.
  Authorization regressions cover new and registered accounts with zero owner Mana, using
  deployment-only sponsor defaults and verifying sponsor payer, owner payee and authorization.
- Live indexer status reports healthy and the expected chain/contracts. SDK verification of
  the live sponsor's signed discovery and chain succeeds. The sponsor prepared an unsigned
  browser-authorization transaction for the reported account with itself as payer; available
  sponsor RC was 1,020,300,000,000 and account RC was 0. No transaction was signed or broadcast.
- Real browser authorization after installing the replacement remains a user-side action;
  the diagnostic above does not claim a live authorization was completed.

## Release and rollout

Website: replace the hosted static files with `OpenSocial-Online-Testnet.zip` contents,
including `.htaccess`, `sw.js`, `manifest.webmanifest`, `icons/` and `assets/`. Keep existing
hashed assets during rollover for tabs still running the old version. HTTPS is required
for installation outside localhost. The first successful online visit prepares the offline
shell; Install app is in the desktop sidebar or mobile More menu. A later release shows an
update prompt instead of forcing a reload while someone is writing.

Extension: replace files in the same unpacked-extension directory, reload the existing
installation and refresh Facebook. This is version 0.1.5, with no additional permissions.

Native nickname endpoint: deploy the updated SDK and indexer when server access is available
(`npm ci`, build proto/SDK/indexer, then restart `osp-indexer` using the existing deployment
procedure). No schema, contract, sponsor or live-chain change is required. The packaged web
client works with the current server without this deployment.

The release is source-published and packaged. This audit does not claim that the hosted
website, indexer process, or user's installed extension has already been updated.
