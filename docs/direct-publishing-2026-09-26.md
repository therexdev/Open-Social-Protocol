# Direct publishing and stable Facebook placement — 0.1.3

The user's screenshots identify the flashing green box as the website's private-post key-sync
notice, and the unwanted extra step as the extension's Queue confirmation. They also report
Open Social cards drifting below Facebook's infinite-scroll posts.

## Changes

- Keep automatic private-post key checks silent. They still run and recover sharing; only a
  manually requested sync displays progress and a dismissible result. Errors remain visible.
- Prefer Facebook's native FeedUnit lane over a secondary role=feed near the bottom of main.
  Remember each card's native before/after anchor and inherit its CSS order. Repair reordering
  and partial removal on scans so unmanaged cards do not accumulate at the scrolling tail.
- Place Public/Friends in Facebook's posting box next to the opt-in. A real user Post action
  immediately publishes the Open Social copy with that audience. It leaves Facebook's own
  Post action and audience setting intact. The extension must be unlocked and authorized.
- Remove the Queue tab and extra confirmation screen. Side-panel Compose also publishes from
  one Post click. Existing drafts and failed/uncertain submissions remain recoverable under
  Compose; old drafts never publish merely because the extension was upgraded.
- Persist an attempt before sending and reuse its idempotency key. Duplicate messages return
  the original outcome; unknown outcomes are looked up before any retry. New publications do
  not require manually reporting a Facebook link or creating a cross-post proof.
- Keep public/friends encryption and signing in the service worker. Validate sender identity,
  granted origin, top frame, gesture, selected audience, text size, current settings and device.
  Synthetic page clicks are rejected by the isolated content script. Read-only embedded cards
  still cannot invoke publication or vault methods.

## Verification

- 85 extension tests pass, including direct Public and encrypted Friends publication through
  the worker/fake sponsor, concurrent-delivery deduplication, sponsor refusal/retry and unknown
  outcome recovery after an orchestrator restart.
- DOM regressions simulate a primary FeedUnit lane plus a secondary bottom feed, 20 repeated
  host reorderings with CSS order changes, partial card removal, trusted Post activation,
  disabled opt-in and synthetic-click rejection.
- 105 website tests pass (two live-network tests skipped), including quiet automatic checks,
  manual repair, queued explicit repairs during a background pass, and dismissed results
  staying dismissed on subsequent checks.
- Production builds/typechecks and the packaged worker, side panel/options/embedded-card,
  and classic Facebook script smoke checks pass. The packaged composer exercises a single
  Friends publication, duplicate activation, no Queue/confirmation screen and repeat navigation.
- No signed-in Facebook acceptance or browser pixel comparison was available. The DOM and
  packaged tests cover the reported mechanisms but do not prove every current Facebook layout.

## Delivery

Extension 0.1.3 uses the existing Harbinger indexer/sponsor endpoints. Replace files in the same
unpacked-extension folder, Reload the existing installation, then refresh Facebook. The flashing
website notice requires deploying the updated web ZIP to opensocial.online. It contains the
existing SPA rewrite and canonical-origin rules. No contract or infrastructure deployment is needed.
