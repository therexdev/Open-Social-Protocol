# Facebook placement, attribution and website polish — extension 0.1.6

## Report and cause

The screenshots show Open Social cards at Facebook's loading tail, then displaced when native
posts load. Feed discovery preferred `FeedUnit_*` markers exclusively whenever any existed.
Loaded `role=article` posts above those placeholders were consequently excluded. The previous
fixtures used the same marker on every post and did not cover this mixed layout.

Discovery now combines both markers, collapses nested markers into one post and finds their
shared vertical lane. Initial cards follow the first native post as placeholders fill in.
External moves and removals restore existing card elements and pagination instead of refetching
the same feed. Route changes still reset the feed. New arrivals continue to be interleaved ahead
of the reader, with identifiers only in the host DOM and protected extension-origin content.

The plugin also did full-page discovery and computed-style reads on every animation frame while
scrolling, and scanned on every keydown/pointerdown. Those are credible sources of extra work;
this audit does not establish how much of the user's Facebook slowdown they caused. Scrolling
now uses a cached lane at most once every 120 ms. Structural mutations invalidate it; typing,
counters, sidebars and the plugin's own correct placements do not. Ancestor discovery uses a
bounded pass rather than repeated candidate-by-candidate searches. Hidden tabs pause observation,
and scrolling wakes an idle observer so later-loaded posts are detected promptly.

## User-facing changes

- Website sidebar spacing adapts to viewport height. About stays on one line; compact laptop
  layouts omit the decorative caption and redundant bottom profile shortcut. Every destination
  remains available, as do installation and account controls. Exceptionally short windows retain
  overflow as an accessibility fallback rather than clipping buttons.
- Activity automatically records the newest successfully loaded notification when the page is
  visible. The manual mark-seen button is removed. The badge clears without another request;
  late requests cannot restore already-read counts or mark a previous account's activity read.
  New arrivals are marked while Activity remains open and visible; failed/hidden/abandoned loads
  are not acknowledged. Seen cursors advance monotonically, including beyond JS safe integers.
- Extension Settings adds a default-on attribution toggle, including for existing installations.
  Checking cross-post opt-in adds this visible footer to the Facebook draft:

  ```text
  Posted on Open Social
  https://opensocial.online/about
  ```

  It uses a plain URL so Facebook can render the clickable link; it does not depend on Facebook
  retaining custom anchor HTML. Native editing commands notify the composer and retain existing
  mention elements. The managed footer is removed on opt-out, setting change or adapter disable,
  and moved below later edits at submission. The Open Social copy excludes only the managed
  footer. An author-written footer is not removed. If the editor declines the edit, a visible
  message explains the failure without overwriting the draft or blocking Facebook's Post button.
  The host can read only the attribution boolean through the new preferences message; account,
  endpoint, key and signing APIs remain unavailable. No additional extension permissions.

## Verification and limits

- Two new regressions failed against 0.1.5: mixed loaded-article/FeedUnit placement and refetching
  after all inserted cards were removed. Both pass after the correction.
- Web: 126 tests pass, 2 opt-in live-network tests skipped. Extension: 100 tests pass. Both
  typechecks pass. Coverage includes repeated placeholder replacement, all-card recovery,
  100 cached scroll passes with zero computed-style reads, typing/counter mutation filtering,
  trusted publishing, attribution preservation/removal, settings persistence and Activity races.
- Both production builds pass. The compiled Facebook script is exercised with mixed markers,
  external card movement/removal, attribution insertion/opt-out and trusted/synthetic Post events.
  The actual Options bundle saves the toggle; existing MV3 CSP, private-card lock and service
  default gates pass. jsdom supplies a native-edit boundary stand-in for these automated tests.
- The browser rejects the local preview with `ERR_BLOCKED_BY_CLIENT`. Real desktop/mobile pixel
  layout, authenticated Facebook editor acceptance, scrolling behavior and wall-clock Facebook
  performance are not claimed as browser-tested. No real Facebook post or chain write was made.

## Update

Upload the website ZIP contents to `public_html`, including the service worker and manifest.
Keep old hashed assets during rollover for existing tabs. Refresh and accept Update app when
offered. Replace files in the existing unpacked-extension folder, reload version 0.1.6 in the
extensions page and refresh Facebook. Existing accounts and preferences remain. The attribution
toggle is under Facebook adapter in extension Settings. No contract or server deployment needed.
