# Open Social Chrome extension 0.5.0

## Install the update

1. Extract `OpenSocial-Chrome-0.5.0.zip` into the same folder as your existing
   unpacked extension, replacing its files. Keep the existing extension installed.
2. Click Reload at `chrome://extensions` or `brave://extensions`. Confirm 0.5.0.
3. Close and reopen the side panel, then refresh Facebook.

The panel opens directly into Browser tools. There is no Social tab, Open in tab
button, website iframe, or separately bundled website application.

## Standalone protocol interface

The extension owns its navigation, routes and layout. Its screens use shared
protocol feature modules directly, keeping compatibility with the website's
formats and access rules without loading the website itself.

- Feed, post details, comments/replies, reactions, weighted votes and polls.
- Post creation/editing/history, photos, voice and video recording/uploads,
  upload progress and retry, individual sharing and audience controls.
- Groups, group banners, members and group music; profiles, photos/albums,
  music and videos with their existing access controls.
- Friends, people search, activity, encrypted messages and voice notes,
  message settings/browser linking, wallet transfers and OSAT rewards.
- Account, identity backup, devices, recovery and network settings.

Feed, Post, Groups, Messages, Friends and Profile are the main buttons. More
contains the remaining features, Facebook connection and recording permissions.
Microphone/camera permission setup can open a small Chrome permission tab; it
does not load the website. Closing the panel stops its active uploads and
recordings. Reopen it and resume saved uploads from Post.

## Existing accounts and history

The former Social view's encrypted account, drafts, remembered sign-in and
message history already live under the extension origin and are reused in
place. No data is deleted or silently replaced.

If you used only the old restricted Browser tools device account, Sign in offers
to continue with that same identity. If its owner seed was retained, enter its
passphrase to make a local encrypted full-account copy. If it holds only a
device key, choose the original identity backup and a passphrase. A device key
cannot restore the owner's identity or authorize profile/wallet management.
An unrelated backup is rejected, and an existing full account is never overwritten.

Facebook keeps its existing restricted device authorization, separate from the
full panel account. Manage or unlock it under More → Facebook connection. A
different connected identity is clearly identified. New connections can use the
unlocked panel identity; creating/renewing authorization requires an explicit
action and the connection passphrase. Renewal retains its device and reading
keys and does not retain the owner seed in the worker unless selected.

Full-account network preferences and the Facebook connection's existing network
preferences are preserved; review both when switching networks. New installs
initialize the full panel preferences from the connection settings.

Facebook light/dark matching, default-on cross-posting, profile invitation
footers, inline interactions, media and feed placement remain included.
Unfinished Facebook cross-posts are accessible from Post and More → Unfinished
browser posts. Unlock the Facebook connection to complete or reconcile them.

No contract, server, indexer or website deployment is required.

## Validation

Tests cover the native routes, local account migration, device authorization
renewal and existing protocol features. Build checks boot the worker, native
client, options and Facebook cards under the extension CSP, and reject a bundled
website directory. Chromium fixture checks cover narrow panel navigation and
existing Facebook interactions. These checks make no live transactions; live
account, microphone/camera and Facebook acceptance still need user testing.
