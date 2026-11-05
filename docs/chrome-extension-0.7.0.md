# Open Social Chrome 0.7.0 — X cross-posting

Replace the files in your existing unpacked extension folder with this ZIP,
click Reload at `chrome://extensions` (or `brave://extensions`), then refresh
your X tabs. Keep the extension installed to retain accounts and settings.

## Use X cross-posting

1. Open More → Browser connections and unlock your existing browser connection.
2. Under X integration, enable X and approve site access if it is not already enabled.
3. Open an X composer. “Also publish to Open Social Protocol” is checked by default.
   Choose Public or Friends for the Open Social copy, independently of X's audience.
4. Write your post and click X's Post button. The extension adds
   `Join Me On Open Social: PROFILE-LINK` with a space after the colon, using your
   connected Open Social account's profile. It adds the invitation on Post,
   not while you are typing.
5. After X exposes the published status link, the extension publishes your text
   to Open Social with that X link at the bottom and in its external reference.

The default-checkbox and profile-invitation switches can each be turned off in
X integration. Per-post unchecking always leaves normal X posting available.
Facebook settings are independent. Existing 0.6.0 X feed users gain composer
integration automatically; there is no new host permission or account to create.
Feed visibility can be turned off while keeping the composer enabled.

Inline and pop-up composers and Ctrl/Cmd+Enter use the same flow. X's native Post
availability determines whether the draft can be sent, including its own character
limit and upload validation. If the added invitation makes it too long, the
extension removes that footer and pauses, keeping your text. Shorten it or turn
off the invitation setting before retrying. Open Social's own text limit is also
checked before X submits.

If the X result is missing or ambiguous, no Open Social copy is sent automatically.
Open Post → Unfinished posts (or More → Unfinished browser posts), paste the
published X post URL and click Publish with X link. Saved attempts reuse their
idempotency keys to avoid duplicate Open Social publications. A pending X result
must finish before another automatically cross-posted X post can start.

This matches Facebook's text-and-link cross-posting: native X photos/videos stay
on X and are accessible through the included link. Multi-post X threads are not
copied as a thread; the checked composer pauses with instructions to post one at
a time or uncheck Open Social. An X post that succeeds is not deleted if the
Open Social submission later fails; use the saved draft's recovery controls.

## Existing features retained

X Home feed integration still supports weighted up/down votes, polls, reactions,
comments/replies, profile images, photos, voice/music and video playback directly
inside its Open Social cards. Cards follow X's light/dark appearance and stay
between native posts as timeline cells recycle. Facebook integration and the
standalone extension frontend remain available.

## Validation

Automated checks cover sender/permission boundaries, independent settings and
migration, Public/Friends publication, exact signed URL/text, tab binding, expiry,
manual recovery, duplicate suppression, native editor updates, footer spacing,
inline/modal composers, keyboard posting, long-draft handling, user opt-out,
locked-account failures and feed virtualization. Browser checks execute the
packaged adapter with controlled-editor fixtures and anonymized structure from
the supplied X capture. All network and host publications in tests are fixtures;
no live X or Facebook posts or blockchain transactions were submitted.

Live signed-in X acceptance remains necessary because X can change its editor
and page structure. Captures and screenshots are not part of this package.

No contract, server, indexer or website update is required.
