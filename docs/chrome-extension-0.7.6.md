# Open Social Chrome 0.7.6 beta

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
site permissions and local history. No contract deployment is required. Operators
must update their sponsor and indexer for large uploads; see
[mainnet recording rollout](mainnet-recording-uploads.md).

Existing testnet preferences are preserved. To move to mainnet, select mainnet
and clear old RPC/indexer/sponsor overrides in the panel’s Settings → Network &
endpoints. Site integrations use separate settings in the extension’s Options
page (right-click the toolbar icon → Options); update those as well.

## Changes

- Hosted posts and comments now allow 100,000 characters, including long stories
  and detailed articles. Public, friends-only, selected-person and group posts
  preserve their existing visibility and encryption.
- The feed offers Read more for long posts; the full post view and edit form keep
  the complete text. Hashtags, mentions and paragraph breaks remain intact.
- Full text is uploaded to R2 with a verified fingerprint. A small optional
  `text_ref` inside the normal authenticated envelope binds that text to the
  existing ledger entry. The chain envelope limit is unchanged.
- Older clients show an update message for long posts. Existing short posts
  remain readable. This long-text feature needs no new contract or VPS deployment
  when the R2 content service is already working.

- Website and side-panel messaging pace RPC requests and back off when the public
  node is busy, retaining pending messages and browser-link approval requests.
- New R2-hosted audio/video supports up to 2 GiB and has no duration limit. Use
  Choose audio to attach podcasts (MP3, M4A, WebM, Ogg or WAV), or record directly.
- Public recordings stream from hosting. Private recordings use authenticated
  encryption chunks and verify the complete fingerprint before playback.
- Large private recordings in embedded Facebook/X cards play in the full Open
  Social side panel; the card explains this rather than transferring a giant
  base64 response through Chrome messaging. Public cards stream directly.
- Hosted recording references are carried by the post, comment or encrypted
  message ledger entry. File size does not add chain chunks or extra Mana fees.
- Legacy on-chain clips remain readable. A hosting operator can set a smaller
  storage allowance; the old short-clip limits still apply on older chain-only
  deployments.

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
