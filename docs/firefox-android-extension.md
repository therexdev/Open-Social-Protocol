# Open Social for Firefox on Android — 0.7.12 beta

This build adapts the existing Facebook/X extension to Firefox on Android 142 or later
(and desktop Firefox 140 or later). Open Social opens in its own browser tab.

## Install

The development ZIP is **unsigned**. Firefox for Android requires a Mozilla-signed XPI;
renaming the ZIP to XPI does not sign it.

1. Sign in at https://addons.mozilla.org/developers/addon/submit/distribution.
2. Choose **On your own** (unlisted distribution), then upload `dist-firefox-unsigned.zip`.
3. Select Android and desktop Firefox compatibility. Complete Mozilla's submission/review
   and download its **signed XPI**. The add-on ID is `opensocial@opensocial.online`.
4. Transfer the signed XPI to the phone.
5. In Firefox, open **Settings → About Firefox**, then tap the Firefox logo five times.
6. Return to **Settings → Install Extension from File**, select the signed XPI and tap **Add**.

Mozilla's installation reference:
https://extensionworkshop.com/documentation/publish/install-self-distributed/

## Connect and test

1. In Firefox's **Extensions** menu, tap **Open Social**. Its account/feed tools open in a new tab.
2. Import the account identity file exported by Open Social, unlock it, and authorize this browser.
   It defaults to the deployed mainnet. Creating a new account creates a separate identity.
3. Open **Settings → Browser connections** in Open Social.
4. Enable **Facebook**, approve its site access, and turn on **Show Open Social post cards**.
5. Enable **X** and approve its site access. Its feed cards are enabled with the integration.
6. Return to https://m.facebook.com/ or https://x.com/home and reload the page.
7. Scroll through the feed. Open Social cards appear among the native posts; try opening replies,
   reacting, commenting and playing media. Unlock Open Social when an action requests it.
8. Create a short text post. Leave **Also publish to Open Social Protocol** checked and choose
   **Public** or **Friends** for the Open Social copy, then tap the site's **Post** button.
9. After the site supplies the published permalink, check Open Social for one copy including
   the original Facebook/X link. The site's own audience setting is separate.
10. Uncheck cross-posting for another post; confirm it stays on the original site only.

If the website does not expose the new post's permalink, or a traditional Facebook form performs
a full navigation, the Open Social draft remains saved. Open **More → Unfinished browser posts**
and supply the published post link to finish it. Do not repost the original. Drafts also survive
an interrupted background process. Automatic cross-posting copies the **post text and source
link**; it does not reupload Facebook/X attachments.

Use the modern Facebook/X website. Facebook comments, Messenger, X DMs and multi-post X threads
are excluded from automatic cross-posting. Website layout changes may require adapter updates.
The profile invitation footer is optional; disable it in Browser connections if the site's
mobile editor does not accept it.

## Build and validate

From the repository root with Node 22+:

```sh
npm ci
npm run build -w packages/proto -w packages/sdk
npm test -w apps/extension
npm run build:firefox -w apps/extension
npm run zip:firefox -w apps/extension
npx web-ext lint --source-dir apps/extension/dist-firefox
```

Output: `apps/extension/dist-firefox/` and `apps/extension/dist-firefox-unsigned.zip`.
For temporary device testing with Android Platform Tools and Firefox USB debugging:

```sh
npx web-ext run --target firefox-android --source-dir apps/extension/dist-firefox --firefox-apk org.mozilla.firefox
```

The background is bundled as a Firefox event page. Extension messaging uses Firefox's actual
runtime URL (its installation UUID differs from the add-on ID). No account keys are placed in
host pages. Feed cards remain extension-owned frames with restricted, post-bound actions.
Facebook/X site access is optional and individually removable. Published content is transmitted
to the configured Open Social services; no analytics are added.

Before declaring this beta ready, run steps 1–10 on a physical Android phone in both portrait
and landscape, including returning from the background and recovering a missing permalink.
