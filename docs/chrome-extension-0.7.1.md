# Open Social Chrome 0.7.1 — X editor and expired extension fixes

## Update

1. Copy any unsent Facebook/X draft text somewhere safe.
2. Replace the files in the existing unpacked extension folder with this ZIP.
3. Click Reload at `chrome://extensions` (or `brave://extensions`). Keep the
   extension installed to retain accounts, settings and saved drafts.
4. Refresh both Facebook and X tabs. Reopen the composer and start a fresh draft.
   A draft already damaged by 0.7.0 is not automatically repaired. Its original
   text may also be copied from More → Unfinished browser posts.

No contract, server, indexer or website deployment is required.

## Fixes

The old X invitation insertion could replace the original sentence and duplicate
the profile link. This was reproduced with a real Draft.js editor: a multiline
editing command changed the browser DOM without preserving the controlled
editor's content and selection state. The earlier simplified editor test missed it.

X now settles its selection inside the last text leaf and sends a single
plain-text paste event through the editor's handler. It checks the complete
result after rendering before clicking Post. The expected content is the
original text, a blank line, and one `Join Me On Open Social: PROFILE-LINK`.
It uses no system clipboard permission, no editor-internal properties, no
replacement editor HTML and no repeated fallback writes.

If X refuses or unexpectedly changes that update, posting pauses and a read-only
copy of the original text appears next to the checkbox. Further clicks cannot
keep inserting links, including after the injected controls are re-created.
Move the original text to a fresh composer to retry. Long-draft cleanup removes
only the managed footer through the editor's cut handler.

On either site, “Extension context invalidated” now produces a useful refresh
message. Stale hooks and controls are removed so they cannot keep swallowing
native Post clicks. Your draft is left intact. If the host post already succeeded,
the message directs you to finish the saved Open Social copy with its published
URL instead of posting again. Refreshing host tabs after extension updates is
still necessary; an invalidated Chrome execution context cannot repair itself.

All 0.7.0 features are retained: default-on sharing, Public/Friends selection,
independent invitation/settings toggles, published-link capture, recovery,
interactive feed cards, media and the standalone browser frontend.

## Validation

The shipped X adapter is exercised against a real pinned Draft.js/React editor,
checking the committed editor state and native submitted value rather than only
visible HTML. Cases include the reported sentence, selected text, cursor at
start/end, paragraphs, emoji, URL decorations, mention entities, long-post footer
removal, refused/corrupt paste, repeated clicks, recreated controls, and expired
contexts before/after host publication. Facebook posting and expired-context
handling, X composer settings and virtualized feed placement are also checked.

Tests use intercepted network and publication fixtures. No live Facebook/X posts
or blockchain transactions were sent. Signed-in live-site acceptance remains
separate from these automated checks.
