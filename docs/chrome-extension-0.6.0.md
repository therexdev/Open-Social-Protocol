# Open Social Chrome 0.6.0 — X feed integration

Replace the files in your existing unpacked extension folder with this ZIP,
click Reload at `chrome://extensions` (or `brave://extensions`), then reopen the
panel. Keep the existing extension installed to retain accounts and settings.

## Enable X

1. Open More → Browser connections.
2. Under X feed integration, click Enable X feed and approve access to X.com.
3. Select Everyone and friends, Everyone, or Friends.
4. Open or refresh X Home. Cards appear between native posts in both For you
   and Following as you scroll, one Open Social card per three detected posts.

The optional X toggle and audience setting are independent of Facebook. Disable X
and remove site access in the same screen whenever you want.

Inline cards support up/down votes, poll answers, reactions, comments/replies,
profile images, photos, voice/music and video previews/playback. Their appearance
follows the host's light or dark mode. Unlock the browser connection to interact
or read private content; public posts remain readable while locked.

The existing restricted site authorization works on both Facebook and X. No
second account or device authorization is needed if that connection is already
set up. The full panel account stays separate, as in 0.5.0. The previous Facebook
connection menu is now called Browser connections. Existing accounts, Facebook
settings, drafts and full-panel features are preserved.

This release integrates the X Home feed. It does not add X composer cross-posting.
Open Social actions remain on the Open Social protocol; they do not like, reply
to or publish native X posts.

## Implementation and validation

The adapter anchors cards inside measured X timeline cells, using status IDs to
recognize recycled rows. It leaves X's absolute positions/transforms unchanged,
allowing its virtualizer to account for the expanded row. Cards are removed from
recycled rows and restored only when their matching tweet returns. Replies,
search, messages, profiles, dialogs and sidebar suggestions are excluded.

Site access is optional and limited to exact X.com/www.x.com HTTPS origins.
X's content script can request post IDs only. Private content and keys remain in
extension frames/worker, with the same verified media, thread ancestry, device
capability and trusted-action checks as Facebook. The worker uses the actual tab
origin to enforce each site's toggle; frame parameters cannot impersonate another
site. Revocation unregisters the adapter and clears its injected content.

Automated tests cover both sites' inline actions, independent settings/permissions,
private content, invalid senders, row recycling, duplicate injection, tab changes,
navigation, resize, themes and removal. Chromium tests use packaged code under
the extension CSP with fixture responses and the supplied X row structure. No
live posts or transactions are submitted. Signed-in X acceptance is still needed
because its live DOM and virtualizer can change.

No contract, server, indexer or website update is required.
