# Mainnet sharing and RPC rollout (Chrome beta 0.7.9)

A share is a new `publications.publish` operation. It appends `quote_post_id` and
`quote_version` (32 bytes each) to the ledger, rather than copying the source body
or media on chain. Hosted content uses the existing compact content reference.
The source must be active, public, outside a private group and at the exact version
approved by the sharer. The link is immutable across edits. The new post can have
its own reading audience. Existing posts/storage field numbers are preserved.

## 1. Upgrade mainnet publications

If GitHub already has a `KOINOS_MAINNET_RPC` variable (under the mainnet
environment or repository Actions variables), replace its value with:

```text
https://api.koinosai.com/,https://api.koinos.io,https://api.koinosblocks.com
```

An existing variable overrides the new defaults. No API key is required for this
public endpoint. Then open the deploy-mainnet GitHub Actions workflow. Select branch
`codex/mainnet-token-free`, choose action `deploy`, and run it. Existing GitHub
mainnet secrets are reused; do not change the contract seed or create new wallets.
The script compares confirmed bytecode/ABI hashes and skips unchanged contracts;
this release changes publications only, and does not deploy OSAT. Verification
checks `get_library_version.quote_reference_version == 1` before committing the
updated mainnet deployment manifest.

Wait for successful deployment/verification. Do not substitute a frontend ZIP for
this step. The frontend blocks new shares on an older contract to prevent silently
losing correlation. Its normal posts continue to work.

## 2. Update the VPS

After the verified deployment manifest is committed, run:

```bash
cd /opt/osp-mainnet
sudo git pull --ff-only
sudo sed -i 's|^OSP_RPC=.*|OSP_RPC=https://api.koinosai.com/,https://api.koinos.io,https://api.koinosblocks.com|' /etc/osp/mainnet-indexer.env /etc/osp/mainnet-sponsor.env
sudo docker compose -f ops/mainnet/compose.yml build indexer
sudo docker compose -f ops/mainnet/compose.yml up -d --force-recreate indexer sponsor
curl --fail https://api.opensocial.online/v1/status
curl --fail https://sponsor.opensocial.online/healthz
```

Both existing env files already contain OSP_RPC. If maintaining a custom file
without that line, add the displayed value with `sudo nano` instead. Keep all R2
and wallet settings as they are. SQLite schema 9 automatically adds quote fields
and an index, preserving the existing database and sync height. No volume removal,
chain reindex, bucket recreation or identity migration is required. Wait until
`healthy` and `chainIdMatch` are true; short startup lag can occur.

## 3. Update website and plugin

Download `web-dist` from the successful CI run for this release or the newer
verified deployment commit. Extract its CONTENTS into Hostinger `public_html`;
index.html must sit directly in public_html. Include downloads/ and other build
assets. Existing browser accounts remain stored locally; hard-refresh the page.

For the plugin, extract `extension-dist` into the same unpacked folder and click
Reload at chrome://extensions. Do not uninstall it or clear browser data.

Mainnet clients default to Koinos AI, then koinos.io, then Koinosblocks. The old
single koinos.io override is treated as the former default and upgraded. Other
custom RPC lists are preserved; clear them in Settings → Network & endpoints to
use the new defaults. Connected-site Options use their own saved endpoint settings.

## 4. Check a share

Open an active public text/photo/audio/video post or poll. Beside Comments, choose
Share → Share to Open Social. Add optional text and publish. It appears as its own
top-level post with the original inside. Copy Link returns the original selected
post's public canonical URL, including when used on the plugin.

Open the new post's `/v1/posts/POST_ID` indexer response: `quotePostId` and
`quoteVersion` identify its source. The corresponding published transaction/event
and `publications.get_post` record retain the same reference. Edits keep it. An
unavailable source shows an unavailable preview rather than republishing its body.
A share into Friends/private/group is encrypted using the normal audience flow;
the original public post remains public.

Read failover retries only explicitly known reads, skips endpoints in cooldown,
and verifies each endpoint's chain ID. Authoritative contract errors are shown
without failover. An uncertain write uses the existing saved-attempt reconciliation
rather than an automatic second submission.
