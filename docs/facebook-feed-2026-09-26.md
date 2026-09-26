# Facebook scrolling feed — extension 0.1.2

The user's screenshots showed the original five-post preview squeezed into a left column. It was
prepended to Facebook's `main` element, which can be a horizontal flex layout containing the feed
and sidebars. The requested result is the site's full post-card appearance inside the scrolling feed.

## Behavior

- Find the actual vertical lane of Facebook post containers, excluding dialogs and sidebars.
  Wait for a recognizable lane instead of guessing that the whole main layout is a feed.
- Insert the latest five Open Social cards before the first host post, below composer/stories.
- Fetch older pages and interleave one Open Social card after every three Facebook posts as they
  approach the viewport. Deduplicate identifiers across initial, older, and refreshed pages.
- Poll for new posts every 30 seconds in a visible tab. New arrivals get priority for upcoming
  insertion positions; never prepend refreshed posts above what the user is already reading.
- Recover from network failures, Facebook route changes, and post-lane replacement. Remove frames,
  timers and listeners on disable. Ignore stale in-flight responses.
- Choose Everyone, Friends, or both in extension settings (both is the default). Friends-only
  content requires the extension to be unlocked and to possess the relevant keys.
- Use the website's actual card stylesheet, with profile names, audience labels, relative times,
  text, opt-in media, reaction counts and replies. The small Open Social attribution identifies
  the source. Support, Like and Reply open the original post on opensocial.online; they do not
  sign transactions in a frame embedded by Facebook.

## Privacy and runtime boundaries

Frames use the extension origin. Only their HTML entry is web-accessible, restricted to Facebook.
The content script gets post IDs and pagination metadata, not private text. A separate `embed`
message source allows only `embed.post`; it requires a subframe in a granted host tab and checks
that feed insertion is enabled. Vault/signing/settings APIs are denied from embedded cards.
The worker uses the same chain verification and epoch-key decryption as its existing feed.
Names decode from protocol profile documents; arbitrary remote profile documents are not fetched.
Session changes clear rendered private text. Read-only feed/card polling does not reset auto-lock.
Resize messages contain only height and are accepted only from the matching frame and origin.

## Verification

- 76 extension unit tests, including encrypted post read-through with the worker, identifiers-only
  content replies, sender/host/frame restrictions, auto-lock activity exclusion, and lock behavior.
- Feed DOM regressions cover the screenshot's three-column arrangement, ambiguous-layout refusal,
  latest-five ordering, cursor pagination, insertion spacing, new arrivals below the reader,
  deduplication, retries, frame resize validation and route/lane replacement.
- Packaged worker, side-panel/options/card pages and classic Facebook script pass smoke checks.
  The actual card bundle is rendered in an independent CSP-restricted realm; checks include profile
  name/audience/text, action destinations, unsafe media exclusion, height-only messaging and clearing
  private text on lock.
- The production indexer uses base64url post IDs, unlike the hex IDs used by stored publication
  attempts. The real encrypted-post regression caught this distinction; host and embedded read
  paths now retain indexer IDs end to end, including padding and URL encoding.

No authenticated Facebook acceptance test was run. A local two-origin visual fixture is included
as `apps/extension/scripts/preview-feed.mjs`; the available cloud browser blocked its localhost URL
with `ERR_BLOCKED_BY_CLIENT`, so no browser screenshot or pixel comparison is claimed.

Update the existing unpacked extension to 0.1.2, reload it, and refresh Facebook. Existing settings
and vault data are retained. This release does not require a website or contract deployment.
