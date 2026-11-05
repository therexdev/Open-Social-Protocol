# Open Social Chrome extension 0.3.0

## Update your extension

1. Extract `OpenSocial-Chrome-0.3.0.zip` into the same folder you originally
   loaded, replacing its files. `manifest.json` must be directly in that folder.
   Keep the existing extension installed to preserve its local account/settings.
2. Open `chrome://extensions` (or `brave://extensions`), enable Developer mode,
   and click **Reload** on Open Social. Confirm version **0.3.0**.
3. Refresh Facebook so its tabs use the new content script.
4. Open **Browser tools**, unlock your existing account, and keep **Show Open
   Social post cards in the Facebook feed** enabled.

For a first installation, use **Load unpacked** and select the extracted folder.
The full Social app remains included. Facebook interactions use the separate
Browser tools device account, so signing into Social alone does not unlock them.
If a card asks for renewed interaction permission, authorize the device again
in Browser tools. An installation that discarded the owner seed needs the
original identity backup for renewal; this does not create a new identity.

## Interact inside the Facebook feed

- Upvote/downvote: choose a weight and confirm in the card. Existing OSAT
  capacity, eligibility and final-vote rules are unchanged.
- Polls: choose an option, submit and change your answer until the poll closes.
  Poll participation remains separate from reward upvotes/downvotes.
- Reactions: choose Love, Happy, Sad, Worried or Surprised. Open the bubble
  again to change it, or select the current reaction to remove it.
- Comments: read, post and reply inside the card, including nested replies.
  Text comments support browser spell checking. Private replies stay encrypted
  for the thread's readers. Confirmed comments may take a moment to be indexed;
  use Refresh comments. A retry after an uncertain result checks the original
  submission before sending anything else.
- Media: archived photos load automatically near the viewport. Video posters
  appear before playback; older clips without posters load a paused preview.
  Video, voice and eligible music play inside the card with native controls.
  Private and purchased media still require the account's existing access/key.

The cards use a white rounded layout with compact icons and Open Social accents.
The previous placement fix remains: one card between every three Facebook posts,
with positions preserved through loading and replacement of native rows.
Profile/source links still open explicitly. Creating media, editing original
posts, buying track access and managing accounts remain in the full Social app.

## Validation and deployment

The extension test suite covers the new action authorization, poll rules,
thread relationships, private recipient verification, encrypted comments,
duplicate/uncertain submissions, media hashes/decryption and session changes.
Production builds also run packaged worker, page, Facebook adapter and Social
app smoke checks.

Chromium fixture checks exercise real button clicks, votes, poll/reaction
changes, comments, audio and MP4 playback, thumbnail-first loading, lock cleanup,
and desktop/narrow layouts under the shipped CSP. The feed-placement regression
uses the reported captured Facebook page structure with its scripts/resources
disabled. These checks send no live transactions. A live signed-in Facebook
session remains the final acceptance test.

No contract deployment, server/indexer update or website upload is required.
