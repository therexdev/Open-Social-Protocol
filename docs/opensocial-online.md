# Deploy Open Social at opensocial.online

This is the existing **testnet** frontend, including the saved-account unlock,
sponsor browser-fetch, and publish-confirmation fixes. It serves from the domain
root and uses the existing deployed contracts and Vultr services.

| Setting | Value |
| --- | --- |
| Website | `https://opensocial.online` |
| Network configuration name | `harbinger` (Koinos Foundation testnet) |
| Indexer | `https://social-api.usekoinos.com` |
| Mana sponsor | `https://social-sponsor.usekoinos.com` |
| RPC | `https://testnet.koinosfoundation.org/jsonrpc` |

The API servers allow cross-origin requests. The frontend uses relative routes,
so no contract redeployment or VPS configuration change is needed for this domain.

## 1. Keep access to your existing account

Before redirecting or removing the old website:

1. Open `https://social.usekoinos.com` in the browser where you created the account.
2. Unlock it, then open **Settings → Export identity file**.
3. Keep the downloaded JSON private: it contains the secret controlling your account.

The passphrase alone cannot move an account between domains. Browser vaults,
settings, unsent drafts and passkeys belong to the original website. The identity
export transfers the account and encryption identity, not settings or unsent drafts.
Keep the old site available until any unsent drafts have been handled.

## 2. Upload the static frontend to Hostinger

1. Add `opensocial.online` to your Hostinger hosting as a custom HTML/static website.
   Use the domain's Hostinger nameservers or the DNS values shown for that website.
   The frontend domain points to Hostinger; the two API domains continue pointing
   to the Vultr VPS.
2. Connect `www.opensocial.online` to the same website and enable SSL for both names.
   Enable **Force HTTPS** in Hostinger.
3. Open **Websites → opensocial.online → Dashboard → File Manager** and enter this
   domain's `public_html` folder.
4. Upload `OpenSocial-Online-Testnet.zip` and extract its contents directly there.
   The folder must contain `index.html`, `.htaccess`, `favicon.svg` and `assets/`,
   without an extra enclosing folder. Replace the existing frontend files if present.
5. If Hostinger's placeholder `index.php` is still the default page, rename it to
   `index.php.backup` so the new `index.html` can load.
6. Visit `https://opensocial.online` and hard-refresh with **Ctrl+Shift+R**.

The bundled `.htaccess` serves deep links such as `/welcome`, `/compose` and
`/post/<id>`. It redirects `www.opensocial.online` to the apex domain, preserving
the path and query. It leaves `social.usekoinos.com` accessible for account export.

## 3. Restore the same account and test

1. On `https://opensocial.online/welcome`, choose **I have an identity file**.
2. Select the JSON exported from the old site. Choose and confirm a passphrase
   for this website, then click **Import account**.
3. A registered account is recognized automatically. If the earlier registration
   never completed, use **Register on the network**.
4. In Settings, confirm the endpoints match the table above. For sponsored testnet
   use, select **Sponsors only (never pay myself)** and save the endpoints.
5. Publish a short Everyone post, then a Friends post. Confirmation should show
   **Publishing…** followed by the post or an explicit error.
6. Refresh a `/post/<id>` URL directly to confirm the rewrite works. If using passkey
   unlock, enroll a new passkey on this domain after importing the account.

## Rebuild the same package

From the repository root, with Node.js 22.5 or later:

```bash
npm ci
VITE_OSP_NETWORK=harbinger \
VITE_OSP_INDEXER_URL=https://social-api.usekoinos.com \
VITE_OSP_SPONSOR_URL=https://social-sponsor.usekoinos.com \
VITE_OSP_RPC_URLS=https://testnet.koinosfoundation.org/jsonrpc \
npm run build:web
```

Upload only `apps/web/dist` contents. Do not upload account exports, seeds, server
environment files or the source repository to the public website directory.

## Friends-only history and account synchronization

Accepting or re-accepting a friendship shares all available previous friends-only
periods, as well as the current period. Both authors complete their side while their
accounts are unlocked. Existing friendships are repaired automatically; no new post,
removal, or new request is required. The Friends page also has **Sync private-post
access**. A success message appears after sharing; network problems show a retry.

The author verifies recovered historical keys against the chain, confirms recipients
are still friends, and sends bounded batches. Removed, pending, or blocked accounts
receive no new keys. Removal rotates both parties' future keys, but cannot erase keys
or copies previously received. Re-accepting restores history access.

Post pages automatically check while indexing catches up. The client verifies post
content and author/version against the chain. Friendship and message views refresh,
and late responses cannot replace a different account's feed or friendship state.
Ambiguous sponsor responses or confirmation timeouts preserve an unknown outcome
instead of silently replaying a submitted action through another payer.

Upload this package over the existing files, refresh, and unlock each account once.
No contract redeployment or account recreation is required. The actual deployments,
test evidence, and remaining release limits are recorded in `docs/friendship-audit-followup-2026-09-26.md`.


Hostinger references:
- [File Manager](https://www.hostinger.com/support/4548688-basic-actions-in-the-file-manager-in-hostinger/)
- [Force HTTPS](https://www.hostinger.com/support/1583201-how-to-enable-or-disable-https-for-your-website-at-hostinger/)
