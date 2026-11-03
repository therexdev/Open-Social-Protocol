# Remembered sign-in and Music upload protection

The client previously kept unlocked account keys only in memory. An inactivity
setting of `0` stopped the timer, but a refresh, browser restart or discarded tab
still opened a locked vault. Settings changes also did not propagate to already
open tabs. This release adds cross-tab settings synchronization and displays the
reason for a lock on the unlock screen.

## Behavior

- Music uploads obtain a bounded inactivity hold, renewed when the chain reports
  progress. Pause, navigation, success and failure release it. A stalled upload's
  hold expires after five minutes without progress; the ordinary inactivity
  policy then applies. Explicit lock and remembered-session expiry always win.
- **Remember this device for 30 days** is optional, unchecked by default, and
  available on the unlock screen and under Settings → Account & security.
- Enabling it pauses inactivity auto-lock and restores the same identity after
  reopening this browser on this origin. The absolute expiry is shown in Settings;
  activity and reloads do not extend it. Re-enabling starts a new 30-day period.
- **Lock now**, turning the option off, changing the passphrase, importing or
  creating an account, and removing the account revoke remembered access. Other
  tabs with the same remembered session lock when notified and also check on
  their timers / visibility changes. A stale tab cannot revoke a newer enrollment.
- Upload bytes are still memory-only. Closing/discarding the page, sleeping the
  device or navigating away can interrupt an upload. After reopening, select the
  original file to resume the existing paid reservation. This does not repay it.

## Security boundary

This is opt-in hot-wallet access for a personal browser profile. Anyone using that
browser can use the account, read private content, export its identity and send
funds without a passphrase while remembered. Both opt-in controls say so.

The existing passphrase-encrypted vault remains unchanged. A separate identity
copy is AES-GCM encrypted under a random, non-exportable WebCrypto key, persisted
as a structured-cloned CryptoKey in IndexedDB. The encrypted payload binds the
account, vault fingerprint, random record id and fixed creation/expiry times.
The key is read back and decryption verified before activation. Expired, corrupt,
mismatched or unsupported records fall back to the ordinary unlock screen.

LocalStorage contains only a random, non-secret activation id; clearing it revokes
access synchronously, even while IndexedDB cleanup is pending. Async unlock and
remember operations check cancellation and current vault/session identity before
activating, so a pending operation cannot undo Lock now. The passphrase and raw
identity are never written to localStorage. This design does **not** protect
against hostile same-origin code, malicious browser extensions, device/browser
profile compromise or manipulation of the local clock. It is a convenience
feature, not an OS authentication or server-enforced session boundary.

References: [CryptoKey extractability](https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey/extractable)
and [structured-clone support](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).

## Rollout

Frontend only; no contract deployment, sponsor restart, seed or VPS changes.
Install the complete new frontend build into Hostinger `public_html`, including
`.htaccess`, `sw.js`, `index.html` and `assets/`. Retain prior hashed assets for
existing browser tabs. Do not clear browser site data: that removes the local
vault and saved uploads. Pause any current upload before refreshing to the build.
After unlocking, enable Remember this device under Account & security if desired.
The package preserves Music, Wallet and username mentions.

## Validation

The frontend suite has 360 passing tests and two existing skips. Automated tests
cover fixed expiry, reload restoration, non-exportability,
corruption/account/vault mismatch rejection, wrong passwords, storage failures,
manual revocation across tabs, cancellation races, password changes/removal,
progressing and stalled upload holds, pause/navigation/error cleanup, and
cross-tab synchronization of auto-lock 0. The full frontend suite and production
build must pass. Real-browser persisted CryptoKey testing and live upload testing
remain rollout checks when a browser executable is unavailable in the build
runtime.
