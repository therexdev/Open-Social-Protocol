# Open Social Chrome extension 0.4.0

## Update

1. Extract `OpenSocial-Chrome-0.4.0.zip` into the **same folder** you originally
   loaded, replacing its files. Keep the existing extension installed so its
   accounts and settings remain available. `manifest.json` belongs at the top level.
2. Open `chrome://extensions` (or `brave://extensions`) and click **Reload** on
   Open Social. Confirm version **0.4.0**.
3. Refresh Facebook. Unlock the existing **Browser tools** account before
   cross-posting or interacting with Open Social cards.

For a first installation, enable Developer mode and choose **Load unpacked**.
The full Social view remains included; it has a separate local account vault.

## Changes

- Open Social cards match Facebook's actual light or dark mode, including changes
  while the page is open. Existing inline actions, profile photos and media remain.
- **Also publish to Open Social Protocol** starts checked on new Facebook posts.
  Turn off **Automatically check…** under Browser tools → Settings to change the
  default. You can still check or uncheck an individual post. Public/Friends is
  the Open Social audience; Facebook retains its own audience setting.
- The profile footer is inserted when you click **Post**, after the Open Social
  draft is saved. It is not inserted while typing or checking the box. The exact
  format is `Join Me On Open Social: https://opensocial.online/u/ACCOUNT`, with a
  space after the colon. ACCOUNT is the unlocked Browser tools identity. The
  separate profile-footer setting can disable this addition.
- After Facebook publishes, the extension captures its post permalink and adds
  that link to the bottom of the Open Social text and its existing source-link field.
  Including it in the text makes it visible on the current website without an update;
  Facebook cards display one clickable source link without repeating it in the preview.
  Tracking parameters are removed. The Open Social copy keeps your original text,
  without the automatically added invitation footer.

If preparation fails (for example, Browser tools is locked), Facebook posting
pauses and the draft remains in its editor with an explanation. Unlock and retry,
or uncheck cross-posting to post only to Facebook.

Facebook does not always expose a usable permalink. If the extension cannot
identify one within a minute, it keeps the Open Social draft saved. Open the
published Facebook post, copy its address, and paste it in **Browser tools →
Compose → Unfinished posts → Published Facebook post link**. Choose **Publish
with Facebook link**. It uses the saved attempt, so retries do not create another
Open Social post. Refreshing or closing Facebook before capture may also require
this recovery. Nothing publishes from the saved draft merely by restarting.

Cross-posting remains text-only; create and upload media using the full Social
view. These changes require no contract, indexer, server or website update.

## Validation

Unit and bundled-build checks cover the settings, account/tab authorization,
permalink validation, reserved link size, duplicate prevention and recovery.
Chromium fixture checks use trusted clicks and native editor input to test footer
timing, delayed URL capture, unrelated navigation, opt-out and preparation errors.
Card checks cover live light/dark changes, parent-message validation, inline
engagement, avatars, images and audio/video playback. Placement checks cover fast
scrolling and recycled Facebook rows. These are controlled fixtures with no live
posts or transactions; signed-in Facebook behavior still needs acceptance testing.
