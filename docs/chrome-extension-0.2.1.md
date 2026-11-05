# Open Social Chrome extension 0.2.1

## Update your existing extension

1. Extract `OpenSocial-Chrome-0.2.1.zip` into the same folder you originally
   loaded for Open Social, replacing its files. `manifest.json` must be directly
   in that folder. Keep the existing extension installed to preserve its settings
   and local account data.
2. Open `chrome://extensions` (or `brave://extensions`), enable Developer mode,
   and click **Reload** on Open Social. Confirm version **0.2.1**.
3. Refresh your Facebook tabs. This replaces the old content script.
4. In Browser tools, keep **Show Open Social post cards in the Facebook feed**
   enabled with your preferred Everyone/Friends setting. Unlock the extension
   for friends-only content.

You do not need to import your identity again if it is already in this extension.
For a first installation, use **Load unpacked** and select the extracted folder
containing `manifest.json`. The full Social app and existing Browser tools from
0.2.0 remain included; microphone/camera setup is unchanged.

## What changed

The reported Facebook layout uses numbered post positions, with deeply nested
wrappers and virtualized placeholders. Its trailing loading skeletons are the
only elements marked as articles. Earlier discovery mistook those skeletons for
native posts, so cards accumulated in a section pushed down by infinite scrolling.

The extension now finds the real native post rows and places **one Open Social
card after every three Facebook posts**, including the initial cards. Each card
keeps its native post position when Facebook reorders or replaces rows. If a row
disappears, its card waits for that position to return instead of moving to the
bottom. A skeleton-only refresh temporarily parks all cards. Scroll handling
reuses the discovered lane; feed structure changes trigger rediscovery.

## Test this update

- Scroll slowly: Open Social cards should appear individually between Facebook
  posts, rather than as a block at the top or bottom.
- Scroll quickly while more Facebook posts load, then scroll back up. Cards
  should remain attached to their respective native post positions.
- Refresh Facebook and confirm the same interleaving behavior.
- Check a card's action links and the existing opt-in cross-post control.

## Validation and deployment scope

105 extension automated tests pass, including numbered/deeply wrapped rows,
loading exclusion, pagination, native reordering, disappearing/reused rows,
full-feed replacement, skeleton-only refresh, iframe message validation, and
cached scroll handling. The production build also runs packaged worker, page,
Facebook adapter, and full Social app smoke checks.

A Chromium test executes the shipped content script against a synthetic fixture
and the reported captured page structure with scripts/resources disabled and
all network requests intercepted. It reproduces the old placement failure and
checks rendered interleaving, fast scrolling, added rows, removal/reordering,
anchor replacement, and observer settling. It uses fixture post IDs and makes
no live transactions. A live signed-in Facebook session remains the final
acceptance check; the browser harness does not install the extension.

No contract deployment, server/indexer update, or website upload is required.
