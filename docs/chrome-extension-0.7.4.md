# Open Social Chrome 0.7.4 beta

This desktop Chrome beta uses Koinos mainnet by default in the mainnet release.
It includes the current hosted content/media client, the simplified free-usage
experience, and optional Facebook and X integrations.

## Install

1. Download the ZIP from https://opensocial.online/browser-plugin and extract it
   into a permanent folder. `manifest.json` must be at that folder's top level.
2. Enter `chrome://extensions` in a Chrome tab. Enable **Developer mode**.
3. Choose **Load unpacked** and select that extracted folder.
4. Pin Open Social through Chrome's puzzle-piece menu and open its side panel.

This is a manually installed beta for desktop Chrome 116+. It is not a Chrome Web
Store listing. Chrome's official guide is available at
https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked.

## Use your account

Create an account in the panel, or import your existing identity backup. To reuse
a website account, export its backup through Settings → Account, then import it
in the plugin's sign-in flow. Website sign-in and plugin sign-in are separate.
Retain your identity backup and protect the plugin with a passphrase.

The standalone panel supports posts, hosted photos/audio/video, groups, friends,
profiles and encrypted messages. For optional site integrations, open More →
Browser connections, connect the intended account, unlock it, complete device
authorization when requested, then enable Facebook and/or X and grant access.
Refresh the connected sites afterwards.

You can insert Open Social cards into supported feeds and use the “Also publish
to Open Social Protocol” checkbox in supported composers. The Open Social copy
contains text and the original published post link. Native Facebook/X media stays
on its original site; use the Open Social panel to publish hosted media directly.
Site audience settings and Open Social audience settings are independent.

If sharing pauses, inspect More → Unfinished browser posts before retrying.
A browser connection can retain a different account from the full side panel;
check the displayed account before authorizing or publishing.

## Update

Save unsent text. Replace the files in your existing unpacked folder with the
new ZIP's extracted files, click **Reload** on its chrome://extensions card, then
refresh Facebook and X. Keep the extension installed to preserve its ID, account,
site permissions and local history. No backend or contract deployment is required.

Existing testnet preferences are preserved. To move to mainnet, select mainnet
and clear old RPC/indexer/sponsor overrides in the panel’s Settings → Network &
endpoints. Site integrations use separate settings in the extension’s Options
page (right-click the toolbar icon → Options); update those as well.

## Changes

- Mainnet packaging carries the current hosted-content and streaming client.
- Embedded avatars and photos load verified R2 bytes, including compact manifests
  and encrypted photos; the avatar cache is bounded by both count and byte size.
- Header counters stay hidden on token-free mainnet; free-usage help appears on
  relevant failures and never automatically retries a transaction.
- Browser Plugin details are available from More and About in the panel and site.
- The website's feed promotes the plugin on desktop and smaller screens.
- Background friend refreshes preserve the rail's empty state and layout.

The automated build checks the extension's CSP and service worker, panel and
options entry points, cross-post fixtures, ZIP contents, version and checksum.
Native desktop browser checks cover the plugin page, download and responsive
layout. These fixtures do not publish real social posts or chain transactions.
Facebook and X can change their pages; beta updates may be needed.
