# Public post link previews

Public `/post/<id>` URLs include Open Graph and X card metadata in their **initial
HTML response**, so sharing sites do not have to execute the React app. The same
page and app shell are served to people and crawlers; no account is required.

The title uses the author's public display name (address if unavailable). The
description contains up to 200 visible characters from the latest post, with
Markdown formatting removed. Photos use a thumbnail; videos use their recorded
poster, without downloading the video. Image-only, video-only and audio-only posts
have readable fallback descriptions. Posts without a suitable image use the
1200 × 630 Open Social card. Existing public posts work without republishing;
older videos without a saved poster use the branded card.

The indexer checks current on-chain public visibility, active state, author and
version before opening a hosted envelope. Hosted text and image bytes must match
their committed fingerprints. Private, group, hidden, deleted, unavailable or
unverifiable posts produce a generic card. No account keys, viewer parameters or
private decrypted content enter this path. Third-party sharing sites can retain
copies of previously public previews in their own caches.

## Mainnet rollout: VPS, then website

No contract deployment is needed for this update. The current mainnet manifest
and existing content remain in use. SSH to the VPS and run:

```bash
cd /opt/osp-mainnet
sudo git pull --ff-only
sudo docker compose -f ops/mainnet/compose.yml build indexer
sudo docker compose -f ops/mainnet/compose.yml up -d --force-recreate indexer sponsor
sudo docker compose -f ops/mainnet/compose.yml ps
curl --fail https://api.opensocial.online/v1/status
```

The status response should contain `"socialLinkPreviews":1`.

`build indexer` builds the shared service image for both services. Do not remove
the Docker volumes. The indexer keeps its database and sync position.

The existing `/etc/osp/mainnet-indexer.env` must contain:

```dotenv
OSP_CONTENT_PUBLIC_URL=https://media-mainnet.opensocial.online
```

If it is missing, add it with `sudo nano /etc/osp/mainnet-indexer.env` before the
`up` command above. The nginx configuration already forwards all API paths, so it
needs no new location block.

Download **web-dist** from the successful CI run for this release. In Hostinger
hPanel → Websites → opensocial.online → File Manager → `public_html`, upload and
extract the ZIP there, replacing the old build files. `index.html`,
`post-preview.php`, `.htaccess`, `social-card.png`, `assets/` and `downloads/`
must be directly inside `public_html`, not in an extra `web-dist` folder. Ensure
hidden files are shown so `.htaccess` is replaced too.

The Hostinger site must execute PHP (8.1 or newer). Normal Hostinger PHP/HTML web
hosting does; a static-only CDN needs an equivalent server/edge handler. The PHP
cURL extension is preferred; HTTPS streams are also supported. The packaged
mainnet handler already points to `https://api.opensocial.online`; no credentials
or additional R2 bucket settings are required. Clear any Hostinger/LiteSpeed or
Cloudflare **HTML** cache for `/post/*`, and exclude `post-preview.php` and post
HTML from full-page caching. Hashed JS/CSS files can retain their existing cache.

## Verify the deployed response

Copy the URL of an existing **public** post using Share → Copy Link. In the VPS
terminal, replace the example URL below with that complete copied URL:

```bash
POST_URL='https://opensocial.online/post/PASTE_THE_POST_ID_HERE'
curl --fail --silent --show-error "$POST_URL" | python3 -c 'import sys; from html.parser import HTMLParser
class Tags(HTMLParser):
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=="meta" and (a.get("property", "").startswith("og:") or a.get("name", "").startswith("twitter:")): print(a)
Tags().feed(sys.stdin.read())'
```

The output should show the author's title, the post's text snippet, its canonical
URL and either an API `/preview/image?version=...` thumbnail or the branded card.
It must appear in `curl`/View Source, not only in the browser's Elements panel.
Open the `og:image` URL directly to confirm that it returns an image. Repeat with
a private/deleted post and confirm that only generic Open Social text is exposed.

If a social site still shows an old card, use its link debugger/refresh scraper
or share a new public post URL; each site controls its own preview cache.

## Implementation and custom hosting

- `GET /v1/posts/:id/preview`: public metadata JSON or a generic document.
- `GET /v1/posts/:id/preview/image?version=<hash>`: freshly authorized, verified
  image, resized within 1200 × 630 and re-encoded as JPEG without EXIF. Source
  image bytes/pixels and processing time are bounded. Video files are not fetched.
- Both endpoints and PHP HTML return `Cache-Control: no-store`. Successful
  permission checks are coalesced only while requests are in flight.
- Outbound body/image reads are restricted to the configured R2 chain/identity
  namespace. Redirects, arbitrary post-supplied destinations, SVG and HTML images
  are rejected. Image and video upload limits are unchanged by thumbnailing.
- Apache/LiteSpeed `.htaccess` routes `/post/<id>` through `post-preview.php`,
  which injects safely escaped metadata into the built `index.html`. A bounded
  API timeout falls back to the normal app with generic metadata.
- The React shell updates/clears card tags on client navigation using the same
  public metadata endpoint. It never builds a card from decrypted private text.
- For custom deployments build with `VITE_OSP_PUBLIC_SITE_URL` and
  `VITE_OSP_INDEXER_URL`. These public settings are baked into the PHP handler.
  The shared mainnet client's Copy Link continues to use opensocial.online.

Development requires PHP CLI to run `scripts/social-preview-php.test.ts` alongside
the normal test suite. Set `PHP_BIN` if PHP is not on PATH. To exercise a specific
cURL module too, set `PHP_TEST_CURL_EXTENSION` to its shared-library path. Tests
use local fixtures, without broadcasting any chain transactions.
