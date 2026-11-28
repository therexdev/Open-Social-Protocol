# Open Social Chrome beta 0.7.10

The standalone panel has the full Open Social editor and hosted media playback.
Website and panel accounts remain separate; import your identity backup to use
the same account. Keep that backup safe.

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

Public post links shared from the website or plugin now support Open Graph and X
cards with an author title, text snippet and photo/video-poster thumbnail. The
website serves these tags before JavaScript runs. Private, deleted and unavailable
posts receive a generic preview. Older videos without a saved poster use the
Open Social card. Existing public posts do not need to be republished.

Quote sharing, visual formatting, rich paste, long posts, hosted audio/video,
messaging and RPC failover remain available. This release does not change how
posts are published or their permissions.

## Operator rollout

Apply the [link-preview rollout](social-link-previews.md): update VPS services and
upload the website ZIP including `post-preview.php` and `.htaccess`. This preview
update requires no contract deployment.
