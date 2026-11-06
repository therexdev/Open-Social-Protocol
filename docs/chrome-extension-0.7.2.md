# Open Social Chrome 0.7.2 — Facebook invitation formatting

## Update

1. Copy any unsent Facebook/X draft text somewhere safe.
2. Replace the files in your existing unpacked extension folder with this ZIP.
3. Click Reload at `chrome://extensions` (or `brave://extensions`). Keep the
   extension installed to retain accounts, settings and saved drafts.
4. Refresh Facebook and X tabs. Open a fresh composer with your original text.
   Remove any invitation already joined to your URL by the old version. This
   update does not rewrite damaged drafts. The original text may also be available
   under More → Unfinished browser posts.

No contract, server, indexer or website update is needed.

## Fix

The Facebook adapter still used a multiline `insertText` command. A real Lexical
editor reproduced the reported failure: the command dropped both newlines, joined
the invitation to the existing URL, and triggered the insertion warning. The
previous simplified Facebook test did not reproduce that editor behavior.

Facebook now uses the verified paste/selection path already used for X, with a
Facebook-specific reader for paragraph and hard-line-break DOM. It sends one
plain-text paste event after settling the selection, then checks the complete
result after rendering before clicking Post. The invitation follows the original
post on a separate paragraph with a blank line and a space after the colon:

```text
Your original post and https://opensocial.online/

Join Me On Open Social: https://opensocial.online/u/YOUR-ADDRESS
```

The original text remains the Open Social copy; its published Facebook URL is
added after that URL is detected. Retrying a prepared draft does not append a
second invitation. Unchecking sharing or disabling the invitation removes only
the managed footer through the editor's cut handler. Audience or settings changes
during preparation pause submission for review.

If the host refuses or corrupts an edit, the extension keeps a copy of the original
text beside the checkbox and stops automatic insertion for that draft. The failure
state survives replacement of the injected controls. Pending edits block native
Post until verification finishes. Removing/reloading the extension preserves the
visible draft. The 0.7.1 X editor and expired-extension handling are retained.

No clipboard permission, system clipboard access, editor-internal properties,
replacement editor HTML or additional host permissions are introduced.

## Validation

The old Facebook failure was reproduced before the fix. The shipped adapter is
then checked in Chromium against pinned Lexical rich-text and plain-text editors,
including an isolated content-script world. Assertions cover the exact reported
draft, original link nodes, paragraphs, emoji, cursor start/end and selected text,
committed model at native submission, permalink completion, opt-out, retries,
refused/corrupt paste, control replacement, audience changes and settings removal.

The full extension unit suite, release build/smoke checks, Facebook publishing
checks, and real Draft.js X regression also run. Editor fixtures and dependencies
are test-only and excluded from the ZIP.

All network responses and publication handlers in these tests are fixtures. No
live social posts or blockchain transactions are sent; signed-in live-site
acceptance is separate from these automated checks.
