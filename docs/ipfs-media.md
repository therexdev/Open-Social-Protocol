# Portable IPFS photos (v1)

The reference web client accepts direct photo uploads. It resizes/re-encodes photos in the
browser, uploads either those bytes (Public) or authenticated ciphertext (Friends), then
publishes a normal OSP content envelope. **No new contracts or migrations are required.**
The service is an optional storage adapter, not a new protocol authority or a message relay.

## Protocol and interoperability

- Store `ipfs://<CID>` in `osp.envelope.media_item.locations`. No Pinata URL, account id,
  API key, or mandatory company hostname is part of the post. This version supports CIDv0
  dag-pb and lowercase base32 CIDv1 raw/dag-pb files with sha2-256 multihashes.
- `content_hash` is SHA-256 of the complete uploaded file (ciphertext for private files),
  **not** a claim that the CID digest always equals that hash. UnixFS CIDs may name a DAG.
- `size` is uploaded byte count; `mime` is the original processed raster MIME type;
  `alt_text` is the optional description. The current composer emits JPEG, maximum 2048px
  on its longest side, under 900 KB before encryption (the API accepts up to 2 MiB). Transparent pixels become white;
  animation is not supported. The original filename and EXIF/GPS metadata are not uploaded.
- Public posts include media both inside the plaintext envelope and in outer `media_ref`s.
- Friends posts have **no outer media refs**. Their CID, MIME, description, nonce, hash and
  protected image key live exclusively in the encrypted content envelope.

Each private image has a new random 32-byte key and 24-byte nonce. The uploaded file is
XChaCha20-Poly1305(image_key, nonce, processed_image, UTF8("osp/media/file/v1")), including
its authentication tag. `media_item.nonce` contains that nonce.

The existing post content key wraps the image key, with a separate random wrapping nonce.
`media_item.wrapped_key` is exactly 73 bytes:

```
0x01 || wrap_nonce[24] || XChaCha20Poly1305(
  post_content_key, wrap_nonce, image_key,
  UTF8("osp/media/key/v1") || SHA256(uploaded_ciphertext)
)[48]
```

The SDK exports `encryptMedia`, `wrapMediaKey`, `unwrapMediaKey`, `openMedia`,
`ipfsCid`, `fetchIpfsMedia`, and upload-proof helpers. Readers verify the post as usual,
unwrap its content key and each media key, fetch the IPFS bytes through their preferred
node/gateway, verify the complete file hash, authenticate/decrypt, and display a local
blob URL. The web client loads photos near the viewport and tries another gateway on a
failure or fingerprint mismatch. Private blob URLs are revoked when the account locks or
the component unmounts; no plaintext image is written to the app's persistent storage.
Uploaded attachment metadata and keys are saved only inside encrypted publication drafts,
so an interrupted blockchain submission can resume without losing image access.

Friends use the existing epoch-key distribution: new friends can receive old post keys;
removing a friend rotates later post keys but cannot revoke earlier downloads or keys.
Editing a caption rewraps the existing image key under the new post content key. It does
not make an already-shared image secret again. This feature does not add forward secrecy
to friends-only posts.

## Replaceable upload API

Any frontend can implement the public API, use another provider directly, or run Kubo.
The contract does not require the reference upload service or proof scheme. Users select
an adapter in Settings → Network & endpoints → Photo upload service; the default is the
first configured sponsor's `/v1/media`. Gateways are independently configurable and default
to `https://ipfs.io` and `https://dweb.link`; the uploading company need not serve reads.
Older frontends require the SDK media support to display encrypted photos.

`GET /v1/media` returns version, enabled, provider, maxFileBytes, dailyFiles and retention.
`POST /v1/media` accepts raw bytes, Content-Type `application/octet-stream`, at most 2 MiB,
and `X-OSP-Media-Proof: base64url(UTF8(JSON))` with:

```
{ chainId, contract, endpoint, account, signer, hash, size, mime, expires, signature }
```

`contract` is the identity contract address; `endpoint` is the exact public upload URL;
`hash` is base64url SHA256(body); `expires` is an integer epoch time in milliseconds,
at most five minutes ahead. MIME is `image/jpeg` for web public uploads and
`application/octet-stream` for encrypted files. Raster PNG/WebP/AVIF are also accepted
from other clients. The signature is base64url koilib `signHash(SHA256(UTF8(canonicalJson({
domain: "osp/media-upload/v1", chainId, contract, endpoint, account, signer, hash, size,
mime, expires }))))`. The service recovers the signer, verifies exact bytes/scope/expiry,
then confirms it is the registered identity's current owner from the chain. It requires
no on-chain signature transaction or extra Mana reservation. API success is:

```
{ url: "ipfs://<CID>", hash: "<base64url SHA256(body)>", size: 1234 }
```

Successful identical files reuse their receipt, including after a restart. Four active
uploads are allowed; each is bounded by a 45-second provider timeout. SQLite conservatively
charges every provider attempt before sending it, including timeouts and crashes whose
provider outcome is unknown. Such attempts can leave orphan pins. There is no automatic
delete/unpin operation, silent paid upgrade, or permanent-retention promise.

## Running the initial free adapter

The sponsor process can host this optional HTTP API independently of paying transactions.
Enable `OSP_MEDIA_PROVIDER=pinata` and set `OSP_MEDIA_PINATA_JWT_FILE` to a permission-600
file containing your Pinata JWT. Use a server-side API key authorized for file uploads.
Never put that JWT in Vite variables, JavaScript, client Settings, git, or chat. The
alternative `OSP_MEDIA_PINATA_JWT` environment variable is supported for container secret
managers; a file avoids putting the value in PM2's saved environment.

The adapter uses `POST https://uploads.pinata.cloud/v3/files`, multipart `file` and
`network=public`. Private OSP images are ciphertext on public IPFS; they do not need a
provider's private-storage plan. To self-host, choose `OSP_MEDIA_PROVIDER=kubo` and
`OSP_MEDIA_KUBO_URL=http://127.0.0.1:5001` (or another operator-controlled URL). Keep Kubo's
administrative API private. The adapter calls `/api/v0/add?pin=true&cid-version=1`.

Initial limits leave headroom under Pinata's September 2026 free tier (1 GB / 500 files):

| Environment variable | Default | Scope |
| --- | --- | --- |
| OSP_MEDIA_DAILY_FILES | 10 | Upload attempts per registered account per UTC day |
| OSP_MEDIA_MAX_FILES | 450 | Provider upload attempts across this service's lifetime |
| OSP_MEDIA_MAX_BYTES | 900000000 | Reserved bytes across this service's lifetime |

Use a dedicated free provider account for this pilot: files uploaded elsewhere consume
provider capacity too. The global cap limits financial/capacity exposure, not Sybil abuse;
registered testnet accounts remain inexpensive. Retain and back up the separate
`<OSP_SPONSOR_DB>.media` SQLite database. Don't reset counters without reconciling provider
storage. The service reports capacity errors; it does not delete users' photos to make room.
If using a reverse proxy, allow requests of at least 2 MiB plus overhead, for example
`client_max_body_size 3m` in the sponsor's nginx server/location. TLS is required except on
localhost. Cross-origin requests are supported so independent frontends can use the API.

## Availability and privacy boundaries

IPFS is content-addressed retrieval, not a promise to store every file forever. Initially,
Pinata is one centralized pinning provider behind a replaceable interface. Losing its pin
can make an image unavailable unless another node retained it. Keep copies/repin the same
CID on independent nodes or providers for durable availability. The protocol does not set
prices or require OSAT payment for storage; paid retention or additional copies can be
optional services without changing posts or controlling readers' keys.

The upload service knows the signing account, upload size and timing; gateways see requested
CIDs and network metadata. Client encryption protects image contents, not this metadata.
Hiding a URL alone would not protect a private image. An authorized reader can save or
redistribute an image. Removing a post cannot erase IPFS copies or blockchain history.

## Validation

Automated tests cover private/public byte handling, scoped owner proofs, changed/expired
proofs, tampered files, wrapped-key binding, concurrent retry deduplication, durable quotas,
provider failures, Pinata/Kubo request formats, bounded downloads, gateway fallback,
photo-only encrypted publications, friend versus unrelated readers, caption edits, and
revoking private blob URLs on lock. A live Pinata round trip requires the operator's own
free API key and is a separate deployment check; offline tests do not establish live
provider availability.
