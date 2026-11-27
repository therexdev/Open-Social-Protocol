# Token-free mainnet deployment

The launch configuration uses the operator's Mana sponsor, 50 Mana per protocol
account per UTC day, and R2 for new content and media. No OSAT token is uploaded,
initialized or issued. Seven social/infrastructure contracts are deployed; the
manifest records a reserved address for a future token module. Economic activation
will need a separate migration and policy decision.

Code/configuration preparation is separate from a live deployment. The definitive
deployment record is a verified `deployments/mainnet.json` with confirmed transaction
IDs. A workflow file, an accounts report, or a simulation is not a deployment.

## 1. Mainnet keys and GitHub configuration

Open **Settings → Environments → `mainnet`** in this repository. The environment
and its two public endpoint variables are already configured for this rollout.
For a fresh repository, create the environment first. Add these environment secrets
separately from the testnet deployment secrets:

| Secret | Value |
| --- | --- |
| `KOINOS_MAINNET_DEPLOYER_WIF` | WIF for the wallet paying deployment Mana |
| `OSP_MAINNET_SPONSOR_WIF` | WIF for your operator-controlled Mana sponsor |
| `OSP_MAINNET_CONTRACT_SEED` | A new random mainnet seed, at least 32 characters; retain an offline backup for upgrades |

Create/select the wallets locally using your trusted wallet. Do not put a WIF or
contract seed in an issue, commit, workflow input or chat. The deployer and sponsor
may be the same wallet for the initial 4,050-KOIN launch. If they are separate,
the deployer also needs sufficient available Mana for deployment; the sponsor's
balance does not pay a different deployer's transactions automatically. Contract
accounts themselves do not need funding. Keep the contract seed off the service VPS.

A seed can be generated locally with `openssl rand -hex 32`. Save it in your password
manager/offline backup before entering it in GitHub. Changing it changes every
derived contract address and prevents upgrades using the original keys.

These **environment variables** contain public configuration (the two URL values
below are already set for this rollout):

| Variable | Example / value |
| --- | --- |
| `OSP_MAINNET_INDEXER_URL` | `https://api.opensocial.online` |
| `OSP_MAINNET_SPONSOR_URL` | `https://sponsor.opensocial.online` |
| `KOINOS_MAINNET_RPC` | Optional; defaults to `https://api.koinos.io` |

Use the same URLs in DNS, reverse-proxy and server configuration. The mainnet chain
ID is pinned to `EiBZK_GGVP0H_fXVAM3j6EAuz3-B-l3ejxRSewi7qIBfSA==`.
No testnet wallet/seed fallback is used by mainnet deployment.

The `deploy-mainnet.yml` workflow must exist on the repository's default branch
before GitHub offers its Run workflow button. The workflow registration can be
merged independently of the application release, so it does not replace the running
website. Open **Actions → deploy-mainnet → Run workflow** and choose
**`codex/mainnet-token-free`** as the branch containing the complete launch code. Always start a new run when using a new commit; re-running an old
job executes that job's original code.

## 2. Verify addresses, then fund the sponsor

The operator revised initial funding to 4,050 KOIN on November 26, 2026. The
50-Mana per-account daily policy is unchanged. The deployment preflight accepts
this revised starting balance.

The [initial address-only check](https://github.com/therexdev/Open-Social-Protocol/actions/runs/45308705089)
stopped before any transaction because the mainnet signing secrets had not been
configured. After adding all three secrets, start a new run.

Run `deploy-mainnet` with **action = `accounts`** first. This prints only public
addresses in the run summary. It submits no transaction and needs no wallet balance.

Verify that the sponsor address matches the wallet you control, then transfer
**4,050 native mainnet KOIN** to that address. If the deployer is different, fund
that wallet for deployment Mana as well. Do not send funds to a contract address
or to a testnet address copied from an older deployment report.

Using Mana does not burn the KOIN. At 4,050 KOIN, the starting pool has up to 4,050 Mana
capacity and approximately 810 Mana/day regeneration. The operator can add KOIN later. The 50-Mana allowance is a
per-account maximum, subject to pool availability. See
[the launch policy](mainnet-token-free-launch.md) for capacity calculations.

Run **action = `simulate`** after funding. The workflow builds/tests the code,
checks the mainnet chain ID and fresh head, then simulates each contract upload.
Inspect the measured Mana report. Simulation does not configure or publish live
contracts and its report covers uploads, not every later bootstrap call.

## 3. Cloudflare R2 and DNS

1. Create a dedicated **Standard R2 bucket** such as `opensocial-mainnet-content`,
   with the default/unrestricted jurisdiction. Keep the testnet bucket separate.
2. Attach your public HTTPS media hostname, for example `media.opensocial.online`.
   If that hostname currently serves the testnet bucket, choose a separate mainnet
   hostname and put that exact base URL in both server configuration files.
   Avoid changing the origin of existing testnet files merely to launch mainnet.
3. Create an R2 API token with **Object Read & Write**, restricted to this bucket.
   Save the S3 Access Key ID, Secret Access Key and Cloudflare Account ID for the
   sponsor server. These credentials do not belong in frontend variables.
4. Set the bucket's CORS policy. Public GET access is required; private bodies
   and private media are encrypted before upload:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Read-only wildcard CORS supports the website, extension, and other protocol clients.
Private content stays encrypted and writes go through the authenticated sponsor
upload route. If changing CORS on a hostname already serving cached objects, purge
its cache so responses receive the new headers. See the
[Cloudflare CORS documentation](https://developers.cloudflare.com/r2/buckets/cors/).

Create DNS records for `api.opensocial.online` and `sponsor.opensocial.online`
pointing at your service VPS. R2's media hostname is configured through Cloudflare
R2, not pointed at this VPS. The main `opensocial.online` website can remain on
Hostinger. Equivalent domain names work if every configuration agrees.

## 4. Deploy the contracts

Run `deploy-mainnet` with **action = `deploy`** from the prepared branch.
This is the step that signs and broadcasts mainnet transactions. It:

1. Checks the actual chain ID and a fresh head before deploying.
2. Runs the test suite and release-WASM bootstrap checks.
3. Uploads seven contracts and configures explicit token-free mode.
4. Enables free hosted photo/audio/video support, with the sponsor as the media
   service recipient; token-free mode charges no KOIN upload fee or OSAT unlock fee.
5. Verifies upload receipts, hashes, dependencies, capabilities and registry entries.
6. Commits the mainnet manifest/progress and builds website/extension artifacts.

Keep the `mainnet-deployment` artifact. The website ZIP is
`OpenSocial-Mainnet-Web.zip`; the extension is under `apps/extension/dist`.

If a deployment fails after submission, preserve its progress file. A new run
reconciles saved transaction IDs before submitting another upload. An uncertain
transaction is not proof that it failed. If deployment completed but a later client
build failed, inspect the manifest/verifier results before deploying again.

## 5. Start dedicated mainnet services on the VPS

The repository includes Docker Compose configuration for a Linux VPS with Docker
Engine/Compose v2, Git, nginx and an HTTPS certificate tool installed. It uses its
own project/volumes and loopback ports so the existing testnet services can coexist.
The image runs the Node services as the unprivileged `node` user. Run these commands
on the VPS after a verified manifest has been committed to your chosen branch:

```sh
git clone https://github.com/therexdev/Open-Social-Protocol.git /opt/osp-mainnet
cd /opt/osp-mainnet
git checkout YOUR_DEPLOYED_BRANCH
git pull --ff-only
sudo install -d -m 700 /etc/osp
sudo install -m 600 ops/mainnet/indexer.env.example /etc/osp/mainnet-indexer.env
sudo install -m 600 ops/mainnet/sponsor.env.example /etc/osp/mainnet-sponsor.env
sudoedit /etc/osp/mainnet-indexer.env /etc/osp/mainnet-sponsor.env
```

Replace every `REPLACE_WITH_...` value in the sponsor file. Its sponsor WIF must
match the funded `OSP_MAINNET_SPONSOR_WIF` used in the addresses report. Set the
same R2 public URL in `OSP_CONTENT_PUBLIC_URL` and `OSP_MEDIA_R2_PUBLIC_URL`.
The indexer file contains no signing or R2 write credentials. Keep the sponsor
file root-readable only; Compose is run with sudo to read it.

```sh
sudo docker compose -f ops/mainnet/compose.yml build indexer
sudo docker compose -f ops/mainnet/compose.yml up -d
sudo docker compose -f ops/mainnet/compose.yml logs --tail=100
curl --fail http://127.0.0.1:8790/healthz
curl --fail http://127.0.0.1:8789/v1/status
```

The sponsor checks the RPC chain ID and live contracts' token-free flags before
listening. The indexer's status endpoint is `/v1/status`; wait for `healthy: true` and
`chainIdMatch: true`. It may need time to catch up from the manifest's first block.
The mainnet sponsor listens internally on 8788/externally on loopback 8790; the
indexer uses 8787/loopback 8789. The `mainnet.json` manifest is copied into the
image at build time; rebuild when that manifest changes.

Install the provided nginx server blocks after matching their domain names to your
GitHub variables. On a typical Ubuntu nginx installation:

```sh
sudo cp ops/mainnet/nginx.conf /etc/nginx/sites-available/osp-mainnet
sudo ln -s /etc/nginx/sites-available/osp-mainnet /etc/nginx/sites-enabled/osp-mainnet
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d api.opensocial.online -d sponsor.opensocial.online
```

Retain the existing server blocks for other sites. Open HTTP/HTTPS to the VPS;
the Node service ports should remain loopback-only. The provided sponsor proxy
supports 12 MiB requests and 90-second upload timeouts.

The sponsor example permits 10,000 upload attempts/account/day, one million total
reserved objects and 100 GB total reserved bytes. These are separate R2 abuse/storage
caps, and include content bodies as well as media. Adjust them deliberately for
your hosting budget. They are not a Cloudflare billing cap. Uncertain uploads retain
their reservation until reviewed; do not clear the database to restore quotas.

## 6. Verify hosting and publish the clients

Run the read-only verification inside the sponsor container, which already has
Node, the schemas and SDK installed:

```sh
sudo docker compose -f ops/mainnet/compose.yml exec -T sponsor node --import tsx scripts/verify-deployment.ts --network mainnet
sudo docker compose -f ops/mainnet/compose.yml exec -T sponsor node --import tsx scripts/verify-r2-media.ts
curl --fail https://sponsor.opensocial.online/.well-known/osp-sponsor.json
curl --fail https://sponsor.opensocial.online/v1/mana-utilization
```

The discovery policy should report `dailyRc: "5000000000"` and
`reset: "utc-calendar-day"`. The utilization endpoint reports aggregate consumed
and reserved RC plus pool capacity/availability/regeneration. It exposes no per-user
rows or alias-to-profile mappings. Individual allowance reads require an expiring
owner/device proof.

Upload the **contents** of `OpenSocial-Mainnet-Web.zip` to Hostinger's domain
`public_html`, including `.htaccess`, `index.html` and `assets/`. Do not add an extra
enclosing folder. In Chrome, load the produced extension directory as unpacked
for your initial rollout; store publication is a separate distribution step.

For later client fixes, use the `web-dist` and `extension-dist` artifacts from a
successful CI run on the deployed branch. When `deployments/mainnet.json` exists,
CI builds these clients for mainnet and includes `.htaccess` in the website artifact.
This does not require another contract deployment. After shared SDK/storage changes,
also pull the updated branch on the VPS and rebuild/recreate the Compose services
so the indexer's hosted-content reads use the updated SDK.

For a local rebuild instead of the workflow artifact:

```sh
npm ci --no-audit --no-fund
npm run build -w packages/proto -w packages/sdk
VITE_OSP_NETWORK=mainnet VITE_OSP_INDEXER_URL= VITE_OSP_SPONSOR_URL= npm run build -w apps/web -w apps/extension
```

After publishing, select **mainnet** in Settings for an existing browser installation
that saved testnet settings. Register the account on mainnet; reusing its keys does
not copy testnet profiles, friendships, posts or messages across chains. Do not
reset an existing vault or discard identity backups to switch networks.

Verify two accounts can post text/images/video, react, answer a poll, add a friend,
create/share a private group and exchange an encrypted message. Check that new
content uses hosted references, restricted content opens for its recipients, and
the header shows a shared sponsored Mana allowance. The R2 verifier also has an
optional encrypted upload/read-back check: set a registered test profile's
`OSP_MEDIA_TEST_ACCOUNT`/`OSP_MEDIA_TEST_WIF` locally and add `--upload`. That check
stores an encrypted object; it does not publish a post.

For subsequent automatic releases through `deploy-web` or a Hostinger Git import,
the default branch must contain the complete mainnet release **and its generated
`deployments/mainnet.json`**. Once mainnet services and the manual client release
are verified, set the repository variable `VITE_OSP_NETWORK=mainnet` and clear
testnet `VITE_OSP_INDEXER_URL`, `VITE_OSP_SPONSOR_URL` and `VITE_OSP_RPC_URLS`
overrides immediately before merging that complete release into the default branch.
Then build/publish from the updated default branch. The mainnet workflow was
registered separately so the initial launch can run from `codex/mainnet-token-free`
while this cutover is being prepared. Its manual artifact takes endpoints from
the mainnet manifest.

## 7. Operations and later changes

To lower sponsorship to 25 Mana, change `OSP_SPONSOR_DAILY_MANA=25` in
`/etc/osp/mainnet-sponsor.env`, then recreate the sponsor:

```sh
sudo docker compose -f ops/mainnet/compose.yml up -d --force-recreate sponsor
```

Existing spending and unresolved reservations survive; lowering the cap does not
reset a user's day. Add another 10,000 KOIN to the same verified sponsor wallet
when you choose. No automatic top-up or threshold-based cap change is configured.

The cap reserves the transaction's signed RC limit and frees the difference only
after irreversible canonical receipts. Pending allowances can therefore take
several minutes to become available. A transport error never releases a potentially
broadcast transaction. Users' selected sponsorship/self-pay preference is preserved.

Back up all three sponsor SQLite databases and their WAL files consistently while
stopped or with SQLite's backup mechanism: `sponsor-mainnet.sqlite`, `.mana`, and
`.media`. The `.mana` database contains private alias attribution; protect it like
other private operational data. Back up the indexer database separately. Do not
use `docker compose down -v` for routine upgrades: that deletes named data volumes.

Later economics are not activated by uploading a token alone. Enabling OSAT will
need a reviewed contract/dependency/client migration and separately defined reward
eligibility/activation rules. Early activity is recorded without a promise of
retroactive token rewards.
