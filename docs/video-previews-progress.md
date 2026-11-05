# Video previews, upload progress, and mobile profile tabs

Release: `2026-11-05-video-previews-progress`

This is a static frontend update. No contract deployment, indexer migration,
sponsor update, or server restart is required. The optional video poster is part
of the post's off-chain content envelope; existing contracts store that envelope
without needing to understand the new field.

## Changes

- Pending uploads show a spinner, percentage, uploaded bytes, total bytes, and
  remaining bytes. The status changes to “Publishing post” while confirmation is
  pending. Resumed uploads include previously received chunks in their progress.
- New video posts include a small JPEG preview generated in the browser. The
  feed downloads the preview first and downloads the video when Play is clicked.
  The original video is not re-encoded to make its preview.
- The preview uses the existing on-chain photo archive and the post's access
  setting. Private previews are encrypted with their own key, wrapped inside the
  same encrypted post as the video. Editing a post preserves its preview.
- Previews fit one photo usage unit, charged through the usual free/regenerating
  OSAT capacity. The video upload fee remains a flat 100 tKOIN on testnet.
- Existing videos, and videos for which the browser cannot create a preview,
  load near the viewport into a paused inline player. At most two passive video
  downloads run at once; the first view may take longer than a new preview.
- At widths up to 700 pixels, profile tabs are six bordered buttons in two rows:
  Posts / Groups / About, then Photos / Music / Videos. Desktop keeps its current
  tab order and appearance.

## Deploy to opensocial.online

1. Download `OpenSocial-Video-Previews-Progress.zip`.
2. In Hostinger File Manager, open the site's `public_html` directory.
3. Upload and extract the ZIP there, replacing matching files. Its `index.html`,
   `.htaccess`, `sw.js`, `release.json`, and `assets/` belong directly in
   `public_html`, not inside another directory. Keep existing hashed asset files
   so already-open browser tabs can finish loading their current version.
4. Reload the site. If the old interface remains, close its tab and reopen it or
   force-refresh the page. Do not clear site storage: that holds local account
   and message data.
5. Check `https://opensocial.online/release.json` for the release above.

No private keys or configuration changes are needed for this deployment.

## Validation

Web tests: 460 passed, 2 skipped. SDK tests: 130 passed. Proto tests: 4 passed.
Regression coverage includes upload progress and resume, failure cleanup,
encrypted preview handling, edit preservation, lazy playback, and mobile tab
order. Browser checks used a real 30-second MP4 and viewport widths 360, 390,
600, 700, 701, and 1440 pixels. They verified preview generation, zero full-video
reads before Play for a new preview, inline playback, paused older videos, and
no profile horizontal overflow. Production build and deployment smoke checks
also passed. These checks use simulated chain responses;
they do not submit a paid transaction to the live chain.
