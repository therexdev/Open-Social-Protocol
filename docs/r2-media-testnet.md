# Cloudflare R2 media on the Foundation testnet

This rollout changes file transport for the reference web client on `harbinger`.
Text, polls, relationships, groups, encrypted post envelopes and private messages
retain their current contracts. Photos, banners, artwork, voice, videos and music
use R2; their existing encryption runs before upload. R2 receives ciphertext for
restricted files and never receives the reading keys. Public file bytes remain public.

The Publications contract gains optional `external_uri` fields on photo and music
reservations. Completed external reservations store the URI, size, full digest and
existing chunk hashes, and emit completion events without uploading file chunks to
the blockchain. Keeping chunk commitments preserves verification and compatibility.
Legacy records still load from chain/indexer history. Existing incomplete legacy
reservations can finish using their original transport. Fees/usage rules are unchanged.

## 1. Cloudflare setup

In your Cloudflare account, enable **R2 Object Storage**, create a dedicated Standard
bucket named `opensocial-testnet-media`, and connect a custom media domain (for example,
`media.opensocial.online`) to that bucket. A Cloudflare-managed domain used for
development can be used during initial testing, but use the custom domain for launch.
Keep private-media keys out of object names, metadata and URLs.

Create an R2 API token restricted to **Object Read & Write** on this bucket only.
Its S3 Access Key ID and Secret Access Key belong on the sponsor server, never in
frontend build variables or GitHub source. Retain the secret in your normal password
manager; Cloudflare only displays it when created.

Set this bucket CORS policy (add the exact test frontend origin if different):

```json
[
  {
    "AllowedOrigins": ["https://opensocial.online", "https://social.usekoinos.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Length", "Content-Type", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Uploads go through the authenticated sponsor endpoint; there is no anonymous R2
write endpoint. A custom domain exposes encrypted restricted blobs and public files.
The application verifies each ciphertext against its chain commitment before local
decryption. Encryption does not conceal file sizes, account activity or sharing metadata.

## 2. Configure the existing sponsor

Use the existing server's environment/secret-file mechanism. Example settings:

```dotenv
OSP_MEDIA_PROVIDER=r2
OSP_MEDIA_R2_ACCOUNT_ID=YOUR_CLOUDFLARE_ACCOUNT_ID
OSP_MEDIA_R2_BUCKET=opensocial-testnet-media
OSP_MEDIA_R2_PUBLIC_URL=https://media.opensocial.online
OSP_MEDIA_R2_ACCESS_KEY_ID_FILE=/etc/osp/r2-access-key-id
OSP_MEDIA_R2_SECRET_ACCESS_KEY_FILE=/etc/osp/r2-secret-access-key
OSP_MEDIA_DAILY_FILES=50
OSP_MEDIA_MAX_FILES=100000
OSP_MEDIA_MAX_BYTES=9000000000
```

Make the credential files readable only by the service account (mode 600). The
equivalent environment variables without `_FILE` are supported when the server's
secret manager supplies them. Account ID, bucket and public URL support `_FILE` too.
The storage caps are cumulative attempted uploads, including uncertain failures;
they deliberately stop new uploads before exceeding the configured budget. Back up
the sponsor's `.media` SQLite database along with its existing data.

The reverse proxy for the sponsor needs `client_max_body_size 12m` (nginx) or an
equivalent limit and at least a 90-second upload timeout. The application enforces
the existing 10 MiB media ceiling and verifies account ownership, signature, expiry,
chain, endpoint, size and ciphertext hash before writing to R2. No provider secret
appears in discovery or frontend configuration.

Build/restart the services using the new branch:

```sh
npm ci --no-audit --no-fund
npm run build -w packages/proto -w packages/sdk -w apps/sponsor -w apps/indexer
pm2 restart osp-sponsor osp-indexer --update-env
```

## 3. Upgrade Publications, then publish the frontend

Run the existing **deploy-testnet** GitHub workflow from `codex/r2-testnet-media`,
select **publications**, and keep the existing deployer key/contract seed. Do not
change addresses or reset the indexer database. This requires the repository's
existing testnet deployment secrets; no mainnet deployment is part of this rollout.

The new capability is `get_library_version.external_media_version = 1` and
`get_music_config.value.external_media_version = 1`. After upgrading the sponsor and
contract, run:

```sh
node --import tsx scripts/verify-r2-media.ts
```

For a real encrypted upload and download check, set `OSP_MEDIA_TEST_ACCOUNT` and
`OSP_MEDIA_TEST_WIF` for an existing registered test account and add `--upload`.
The script uploads a small encrypted sample, checks delivery and decrypts locally;
it publishes no post and logs no keys.

Build the frontend with `npm run build:web`, then deploy `apps/web/dist` to the
existing Hostinger site. Testnet clients default to R2 and stop if its configuration
or contract capability is unavailable. The upload endpoint defaults to the selected
sponsor's `/v1/media`; `mediaUploadUrl` is also a supported settings override. For a
staged rollback, build with `VITE_OSP_MEDIA_STORAGE=chain` to restore the old upload
transport. Old cloud media remains readable by this version regardless of that flag.

Verify public/private photos, selected-person sharing, albums, group banners,
artwork, music access, voice in messages, short videos and an interrupted upload.
Inspect the chain transaction: it must contain a reservation/reference and hashes,
with no append operation or full media bytes. Confirm another authorized account
can decrypt and an unapproved account cannot. Locking must still dismiss private media.

## Availability and backups

R2 durability is not an independent backup. Configure a second provider and verify
restores before promising durable media retention. This change introduces no
community storage rewards or permissionless storage-provider network. Existing
on-chain media remains in historical blocks; this rollout prevents future bulk
media writes through the updated client.
