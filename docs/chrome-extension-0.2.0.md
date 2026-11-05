# Open Social Chrome extension 0.2.0

## Install the test update

1. Extract `OpenSocial-Chrome-0.2.0.zip` into the same unpacked-extension folder
   you currently use, replacing its files. `manifest.json` must be directly in
   that folder. Do not remove/uninstall the existing extension.
2. Open `chrome://extensions`, enable Developer mode, and click Reload on Open
   Social. Check version **0.2.0**. For a first installation, choose Load unpacked
   and select the extracted folder containing `manifest.json`.
3. Refresh any Facebook tabs to replace their old content scripts.
4. Open the extension. **Social** is the full app; **Browser tools** preserves
   the older Facebook account/authorization, quick composer, and saved attempts.
5. In Social, choose **Sign in with an identity file** and import your existing
   account backup once. Choose a passphrase to protect it in this extension.
   This is the same on-chain account, with a separate local encrypted vault.

The restricted device key used by Facebook is not upgraded or exported into the
full app. Keep your original account backup. Do not create a new account just to
replace an existing account whose backup you still need to retrieve.

For recording, open **Microphone / camera** at the top of Social, enable the
needed devices in that tab, then return to record. The setup check stops the
devices immediately and does not save a recording.

For existing private-message history, use the message settings button to link
the extension client with a browser that already has your messages. Importing
an identity does not recreate history held only on another browser.

## Included features

The extension bundles the current web app's shared components. It includes post
editing and revisions; voice in posts/comments/messages; 10–30 second video
uploads/recording; upload spinner, percentage and remaining size; feed video
previews; photos/albums and access controls; music; weighted votes; selectable
reactions; polls; mentions; profile pictures and banners; the mobile six-button
profile menu; group banners and Posts/Music tabs; messaging/browser-link settings;
wallet transfers; automatic OSAT rewards; and the OSAT total at $0.17 per OSAT
on testnet. Video/music upload pricing remains unchanged.

Switching to Browser tools preserves the Social view so an upload can continue.
Closing the sidebar or tab stops that page's work; reopen it to resume a saved
upload. For a longer session, choose **Open in tab** before starting the upload.
Facebook cross-posting remains explicit and text-only. New media is created in
Social; Facebook's embedded media/action links open the bundled Social client.

## Suggested test

- Import your existing account and check the username, OSAT amount, and total.
- Open your profile and check Photos, Music, Videos, Groups, and About.
- Record a voice note and upload the 30-second test MP4. Confirm the progress
  indicator, then the preview/playback in the feed. Each preview uses one normal
  photo usage unit; the video fee remains 100 tKOIN.
- Edit a post, view its history, and change a reaction.
- Open a group and switch between Posts and Music; check its banner.
- Link message history and test a voice message with another account.
- Switch to Browser tools and confirm the existing Facebook device/account is
  still present. Refresh Facebook and test its opt-in controls.

## Validation and deployment scope

Extension: 102 automated tests. Shared web client: 460 passed, 2 skipped.
Production build and packaged worker/page/Facebook/full-app smoke checks pass.
A browser test loads the actual shipped files with the manifest CSP and fixture
network responses, checking identity import, OSAT total, profile tabs, preserved
view state, synthetic microphone recording, a real 30-second MP4 preview, and
initialization of the bundled encrypted-messaging WASM engine. It sends no live
transactions. Installed Chrome and authenticated Facebook are the remaining
user acceptance tests; the browser harness does not install the extension.

No contract deployment, server/indexer update, or website upload is needed for
this extension release.
