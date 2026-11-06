# Open Social Chrome 0.7.3 — Facebook post-link handoff

## Update

1. Save any unsent draft text, then replace the files in the existing unpacked
   extension folder with this ZIP.
2. Click Reload in `chrome://extensions` or `brave://extensions`.
3. Refresh Facebook and X. Keep the extension installed to retain the account,
   settings and saved cross-posts.

No website, server, indexer or contract deployment is needed.

## Finish a Facebook post already published

Do not post it on Facebook again. Open the extension → More → Unfinished browser
posts. Find the saved copy, paste the URL of the published Facebook post, and
choose **Publish with Facebook link**. If the browser connection is locked,
unlock it under Browser connections first. This completes the existing attempt.
If it reports a transaction error, keep that error for diagnosis rather than
creating a new draft.

Updating the extension does not automatically resume link detection for a post
submitted in an older tab session.

## Changes

The Open Social copy waits for the published Facebook permalink so it can include
that URL in both its visible text and external reference. Link detection previously
missed two cases: paragraph DIVs joined by textContent, and timestamps whose href
contains tracking parameters until Facebook handles a hover. The earlier supplied
Facebook capture contains these unresolved timestamp links. This does not prove
which case caused a particular user's attempt; its saved queue state is needed
for that diagnosis.

The detector now preserves paragraph boundaries and requests hydration of an
unresolved timestamp on a new matching post through normal mouse/pointer hover
events. It reads the resulting href, strips tracking parameters, and completes
the saved copy. It never clicks links, navigates, guesses IDs, reads private React
state or calls Facebook's private publishing APIs. Old rows, embedded references,
quotes, unrelated links and ambiguous matches are excluded. Hosts that do not
respond to synthetic hover can still require manual recovery.

A persistent status panel distinguishes finding the Facebook link, publishing
the Open Social copy, confirmed publication, and errors. After 15 seconds without
a detected URL, it offers a link field directly on Facebook. Automatic detection
continues for up to one minute unless the user finishes or dismisses the attempt.
Recovery keeps the same saved attempt and does not repost to Facebook. Rejected
transactions are reported as failed rather than pending; an explicit retry remains
available. The original Public/Friends selection is retained.

The 0.7.2 editor formatting and 0.7.1 X/stale-context fixes are retained. This update
does not add permissions or change the protocol.

## Validation

- Composer-to-worker integration checks the actual signed/encrypted test envelopes
  and resulting feed card: Public and Friends copies contain the Facebook URL in
  their text and external reference, with one native submission and one protocol post.
- Browser tests run the shipped script against real Lexical editors, including
  isolated-world hover hydration, paragraph markup, URL capture and native submission.
- Browser recovery tests cover a missing link, invalid-link error, rejected
  transaction, explicit retry, persistent success status, and no Facebook repost.
- Unit checks cover old-row protection, nested references/quotes, ambiguous links,
  success notices, recovery event authorization and failed-completion status.
- Existing editor, posting, full unit-suite and release smoke checks are retained.

These checks use local host, worker-network and blockchain fixtures; no live
Facebook posts or blockchain transactions are sent. Live Facebook may expose a
link differently, in which case the persistent status and saved-draft recovery
remain available.
