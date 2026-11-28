# Open Social Chrome beta 0.7.9

The standalone panel has the full Open Social editor and hosted media playback.
Website and panel accounts remain separate; import your identity backup to use the
same account. Keep that backup safe.

## Install or update

Download the plugin ZIP from https://opensocial.online/browser-plugin and extract
it into a permanent folder with manifest.json at its top level. Open
chrome://extensions, enable Developer mode, choose Load unpacked and select that
folder. Pin Open Social through Chrome's puzzle-piece menu and open its panel.

For an existing installation, save unsent text, replace files in the SAME folder,
and click Reload on its chrome://extensions card. Keep the extension installed;
uninstalling or clearing its data can lose locally stored keys and message history.
Refresh Facebook/X after updating.

## Changes

- Share beside Comments offers Share to Open Social and Copy Link. Sharing opens
  the composer with a quoted public source, plus optional commentary or media.
  The new post records the source ID and original version on chain; content stays
  with the configured hosting operator. Only public posts can be quoted. Copying
  a private link does not grant access.
- Quoted previews show the original shared version, with a link to the latest post
  if it has since been edited. Hidden/deleted sources become unavailable. Previews
  stop after one level so chains of shares cannot expand indefinitely.
- The audience dropdown sits beside You; smaller Post/Voice/Video controls sit
  underneath beside the avatar. Close is inside the box, drafts have a proper
  button, and Add media by URL is removed. Ordinary rich-text links still work.
- Mainnet defaults to https://api.koinosai.com/, then https://api.koinos.io and
  https://api.koinosblocks.com. Safe reads fail over automatically with pacing,
  cooldowns and network-ID checks. Transaction writes are never automatically
  replayed. The former single koinos.io default upgrades automatically; custom
  endpoint lists remain in place.
- Visual formatting, rich paste, formatted polls, long posts and larger hosted
  audio/video uploads remain available.

## Operator rollout

This release requires a publications contract upgrade and updated indexer/sponsor.
Use [the share rollout guide](mainnet-sharing-rollout.md) before relying on quotes.
Until the chain upgrade is detected, a share remains a saved draft; the client
never silently publishes a post with its quote reference missing.

For Facebook/X integration, enable the site in More → Browser connections, grant
its permissions and authorize the intended account. Browser integration settings
are separate from the full panel; check the displayed account before publishing.
