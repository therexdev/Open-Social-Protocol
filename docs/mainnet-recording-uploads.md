# Mainnet long recordings and messaging recovery

This release fixes browser RPC rate-limit loops and supports long audio/video on
the existing R2 setup. It requires new website/extension builds and an updated
sponsor/indexer. **No contract deployment is needed.**

## Update the VPS

```bash
cd /opt/osp-mainnet
sudo git pull --ff-only
sudo docker compose -f ops/mainnet/compose.yml build indexer
sudo docker compose -f ops/mainnet/compose.yml up -d --no-deps --force-recreate indexer sponsor
curl --fail https://sponsor.opensocial.online/v1/media
```

The final response should include:

```json
"multipart": {
  "version": 1,
  "partBytes": 8388608,
  "maxFileBytes": 2147483648
}
```

Existing environment files, R2 credentials, daily usage policy and Docker volumes
are retained. `OSP_MEDIA_MAX_UPLOAD_BYTES` optionally lowers the large-file limit;
the default is 2 GiB including encryption. `OSP_MEDIA_MAX_FILE_BYTES` still governs
the original small-object upload endpoint. Its existing 25 MiB value can stay.
`OSP_MEDIA_MAX_BYTES`, `OSP_MEDIA_MAX_FILES` and `OSP_MEDIA_DAILY_FILES` remain the
operator's overall hosting budget. They count a resumable file once, including
uncertain attempts, and are independent of chain Mana accounting.

Each browser request is at most 8 MiB. The existing mainnet Nginx 32 MiB body
limit and R2 GET/HEAD CORS policy suffice. Finishing runs in a background job,
with status polling so a large file does not depend on a long HTTP response.
Temporary uploads use the existing sponsor data volume; incomplete sessions
expire after 24 hours and are cleaned when the service receives a new upload.
The normal writer aborts failed R2 multipart uploads. R2's default lifecycle also
expires incomplete multipart uploads after seven days; see
[Cloudflare's lifecycle documentation](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

## Website and Chrome

Download `web-dist` and replace the website files in Hostinger `public_html`,
including `downloads/`. Reload the site. Update Chrome by replacing files in its
existing unpacked folder and clicking Reload at `chrome://extensions`.

Keep Messages open and unlocked in both places. Existing saved link requests
retry automatically. Open Message settings on the receiving browser, compare
the displayed codes, then approve the matching link. Mainnet confirmation is
still required before accepting encrypted invitations and advancing cursors.

## Media behavior

- New hosted video/audio posts have no duration ceiling and accept files up to
  2 GiB. Audio supports MP3, M4A, WebM, Ogg and WAV; video supports MP4 and WebM.
- The browser hashes the file incrementally. Public files retain their original
  bytes; private files use authenticated encryption chunks without a full-file
  base64 draft. Keys remain in the encrypted post/comment/message descriptor.
- The server accepts signed upload reservations, small idempotent parts and a
  renewed signed completion request. It verifies current upload authority and
  the full size/SHA-256 before issuing an R2 receipt. Temporary disk files and
  streamed R2 multipart writes bound VPS memory use.
- Public recordings use native ranged playback. Private playback verifies the
  full ciphertext fingerprint and all encryption tags before creating a player
  Blob. Browser locking or switching accounts cancels the in-flight player.
- `osp-file:https://.../osp/.../<ciphertext digest>` is a compact media location
  inside the existing post/comment/message ledger reference. The file does not
  require a `begin_music` reservation or per-chunk chain writes. The old media
  contract's clip-duration and size rules do not apply to this transport.
- Existing `osp-clip` recordings retain their legacy verification/playback path.
  The music library's legacy licensing/archive flow remains separate from audio
  posts, podcasts, voice comments and encrypted message attachments.

Interrupted parts retry at the same offset. Public recordings can resume from
the same file after reopening the page. Private encryption uses fresh keys on a
new selection; keep the page open during the upload. Cancelled or abandoned
uploads never publish a post or disclose a private reading key.

Messaging RPC calls are paced and identical in-flight reads are combined without
caching completed authorization reads. HTTP rate limits and CORS-hidden transport
failures open a shared cooldown. Pending ciphertext and link requests remain
saved, and a submission is never automatically replayed by this transport.
