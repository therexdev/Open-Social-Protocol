# Open Social Chrome beta 0.7.11

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

- The feed opens directly with its content controls, without the large headline
  and subtitle. The mobile create-post shortcut stays available.
- A small close control dismisses the browser plugin promotion. The choice is
  remembered in that browser and applies to both mobile and desktop placements.
  Browser Plugin remains available in More and the desktop footer.
- Revision history has a bordered expand button and count badge. Each version
  has its own dropdown button, date, Current badge where appropriate, and a
  bordered panel showing its verified content. The controls work with a keyboard.
- Public link previews, rich formatting, quote sharing, hosted media and private
  messaging remain available.

## Website rollout

Upload the matching web-dist ZIP contents directly into Hostinger public_html,
including .htaccess, post-preview.php, assets/ and downloads/. Replace the previous
build and clear any HTML cache. This interface update requires no VPS or contract
changes. If public link previews have not been deployed yet, follow
[the link-preview rollout](social-link-previews.md) for that separate server update.
