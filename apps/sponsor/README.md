# @osp/sponsor

The replaceable Mana sponsor for Open Social Protocol (spec section 10, `docs/sponsor-api.md`).
Users sign transactions as **payee** (their nonce), the sponsor validates, co-signs as **payer**
and broadcasts. The sponsor never modifies operations, publishes its policy on chain and over
HTTPS, refuses with stable categories and reports aggregate utilization. Anyone can run one;
clients keep an ordered list of sponsors and fall back to self-pay, so a sponsor going away never
removes a user's ability to act.

```sh
npm run build -w apps/sponsor      # tsc -> dist/
npm test -w apps/sponsor           # vitest, fully offline (fake provider + synthetic deployment)
npm run typecheck -w apps/sponsor  # strict typecheck of sources and tests
OSP_NETWORK=harbinger OSP_SPONSOR_WIF=5K... npm run sponsor   # http://0.0.0.0:8788
```

## Running your own sponsor (the replacement path)

1. Create a Koinos account for the sponsor and fund it with KOIN (Mana regenerates from the
   balance). Keep its WIF private key for the service only; it never leaves the process.
2. Make sure `deployments/<network>.json` exists (produced by the deploy-testnet workflow or
   `npm run deploy:testnet`). Without it the service still starts and answers `/healthz` with
   `state: "not_deployed"` and every API call with `503 temporarily_unavailable`.
3. Start the service behind HTTPS (a reverse proxy is fine) and set `OSP_SPONSOR_PUBLIC_URL`
   to the public base URL, e.g. `https://sponsor.example.org`.
4. On start the service compares the on-chain `sponsorship.sponsor_record` with its policy and,
   when it differs, submits a self-paid `sponsorship.set_sponsor` (`OSP_SPONSOR_REGISTER=true`,
   the default). RPC failures are logged, never fatal. The contract accepts `https://` endpoints
   (and `http://localhost...` for local testing only).
5. Point clients at it: add the URL to `deployments/<network>.json` `sponsors`, or set
   `VITE_OSP_SPONSOR_URL` for the web client / extension, or enter it in Settings. Clients verify
   the signed discovery document against the `sponsor` address before using it.

Nothing else is required. Several sponsors can serve the same network; each is independent.

## Policy

**Default allowlist**: every non-read-only method of `identity`, `relationships`,
`publications` and `communities` except the contract-account administration setters
(`set_identity_contract`, `set_relationships_contract`). `sponsorship` and `registry` methods
are never funded unless listed explicitly.

`OSP_SPONSOR_ALLOWLIST` replaces the default with a `contract:method` list, e.g.
`publications:publish,publications:react,relationships:*` (`*` = every non-admin write method
of that contract). Read-only and unknown methods are rejected at startup.

**Per transaction**: 1..`OSP_SPONSOR_MAX_OPS_PER_TX` `call_contract` operations, each addressed to
a deployed protocol contract with an allowlisted entry point, each `args` payload at most
`OSP_SPONSOR_MAX_BYTES_PER_OP` bytes, and `rc_limit <= OSP_SPONSOR_MAX_RC_PER_OP x operations`.

**Actor binding (anti quota gaming)**: every operation is decoded and the acting account of the
method (`account`, `author`, `actor`, `requester`, `approver`, `follower`, `creator`, `owner`,
`sponsor`, or `guardian` for `identity.propose_recovery`; see `ACTOR_FIELDS` in
`src/policy.ts`) must equal `header.payee`. When the operation names a `device`, the device may
be the payee instead (spec section 3.2: the device signs). Methods anyone may call
(`identity.execute_recovery`, `communities.execute_owner_transfer`) have no actor to bind. Usage
is always charged to the payee, and a signature must recover to the payee, so a user can only
spend their own quota.

**Per user (payee)**: `OSP_SPONSOR_DAILY_OPS` operations per UTC day (persisted in SQLite) and
`OSP_SPONSOR_BURST_OPS` operations per `OSP_SPONSOR_BURST_WINDOW_SEC` seconds (in memory).
Reverted transactions count: the sponsor paid for them.

**Signature checks**: the merkle root and transaction id are recomputed from the submitted
header and operations; a mismatch (anything changed after signing) is `invalid_signature`. At
least one signature must recover to the payee. The sponsor only appends its own signature.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `OSP_NETWORK` | `harbinger` | Reads `deployments/<network>.json` (chain id, RPC list, contract addresses) |
| `OSP_DEPLOYMENT_FILE` | - | Explicit manifest path (overrides the network lookup) |
| `OSP_RPC` | manifest `rpc` | Comma-separated RPC override (failover in order) |
| `OSP_SPONSOR_WIF` | - | Payer private key (WIF). **Required to serve**; without it `/healthz` reports `no_key` |
| `OSP_SPONSOR_PORT` | `8788` | Listen port |
| `OSP_SPONSOR_HOST` | `0.0.0.0` | Listen host |
| `OSP_SPONSOR_PUBLIC_URL` | `http://localhost:<port>` | Public base URL (discovery `endpoint`, on-chain record) |
| `OSP_SPONSOR_DB` | `./data/sponsor-<network>.sqlite` | SQLite file for quotas and utilization (`:memory:` allowed) |
| `OSP_SPONSOR_DAILY_OPS` | `200` | Operations per payee per UTC day |
| `OSP_SPONSOR_BURST_OPS` | `20` | Operations per payee per burst window |
| `OSP_SPONSOR_BURST_WINDOW_SEC` | `60` | Burst window |
| `OSP_SPONSOR_MAX_BYTES_PER_OP` | `6144` | Ceiling on each operation's encoded `args` |
| `OSP_SPONSOR_MAX_RC_PER_OP` | `200000000` | RC ceiling per operation (`rc_limit <= ceiling x ops`) |
| `OSP_SPONSOR_MAX_OPS_PER_TX` | `4` | Operations per transaction |
| `OSP_SPONSOR_ALLOWLIST` | default policy | `contract:method,...` override |
| `OSP_SPONSOR_POLICY_VERSION` | `1` | Policy version in discovery and on chain; bump when the policy changes |
| `OSP_SPONSOR_REGISTER` | `true` | Register/update the on-chain sponsor record on start |
| `OSP_SPONSOR_LOG_LEVEL` | `info` | Fastify/pino log level |

## API

All responses are JSON with CORS for every origin. Errors are
`{ "error": { "category", "message", ...details } }` with the categories from
`docs/sponsor-api.md` and these statuses: `quota_exceeded` 429 (plus a `retry-after` header),
`method_not_allowed` 403, `too_large` 413, `chain_mismatch` / `invalid_signature` /
`invalid_transaction` 400, `temporarily_unavailable` 503.

* `GET /healthz` - `{ ok, state: serving|not_deployed|invalid_deployment|no_key, message, sponsor, chainId, rpc, policy, allowed, ... }`; 200 when serving, 503 otherwise.
* `GET /.well-known/osp-sponsor.json` - signed discovery document (`signSponsorDiscovery`, cached):
  `version`, `sponsor`, `network { name, chainId, rpc }`, `policy { version, allowed: [{ contract, entryPoints, methods }], maxBytesPerOp, maxRcPerOp, maxOpsPerTx, perUser { dailyOps, burstOps, burstWindowSec } }`, `endpoint`, `protocolVersion`, `contracts`, `signature`.
  Verify with `verifySponsorDiscovery` from `@osp/sdk`.
* `POST /v1/prepare` `{ payee, operations }` -> `{ transaction }`: an unsigned transaction with
  `header.payer` = sponsor, `header.payee` = user, the payee's next nonce, `chain_id` and
  `rc_limit = min(maxRcPerOp x ops, sponsor's available RC)`. Operations are validated first.
* `POST /v1/sponsor` `{ transaction }` -> `{ transaction, receipt }`: validate, quota check,
  append the sponsor signature, broadcast (`chain.submit_transaction` with `broadcast: true`),
  record usage. A reverted transaction answers `400 invalid_transaction` with `error.logs` and the
  `receipt`; an RPC failure answers `503 temporarily_unavailable` (nothing was recorded).
* `GET /v1/utilization` - `{ generatedAt, limits, today, yesterday }` where each day carries
  `accepted`, `acceptedOps`, `reverted`, `rcUsed`, `refused { <category>: n }`, `refusedTotal`
  and `users` (a count). No per-user data is exposed.

With `@osp/sdk`:

```ts
const client = new ProtocolClient({ deployment, sponsors: ["https://sponsor.example.org"] });
const { sponsored, receipt } = await client.submit({ operations: [op], signer: me.signer });
```

## On-chain registration

`src/register.ts` builds the `sponsorship.set_sponsor` arguments from the policy (`endpoint`,
`policy_uri = <endpoint>/.well-known/osp-sponsor.json`, `policy_version`, `allowed` as
`allowed_call { contract_id, entry_points }`, `max_rc_per_op`, `max_ops_per_user_per_day`,
`max_bytes_per_op`, `active: true`), compares it with `get_sponsor` and submits a self-paid
transaction only when something differs. To retire a sponsor, call
`sponsorship.deactivate_sponsor` from the sponsor key (any koilib script) and stop the service.

## Capacity guidance

Mana regenerates over five days, so a sponsor's usable budget is roughly its Mana balance every
five days. Reserve about **5x the expected daily RC** as Mana: with the defaults
(`200000000` RC ceiling per operation, `200` operations per user per day) one very active user
could consume up to 4 x 10^10 RC per day at the ceiling, but typical protocol operations use a
small fraction of it (the deploy script and `GET /v1/utilization` report measured `rc_used`).
Size the balance from observed `rcUsed` per day x 5, plus headroom, and lower
`OSP_SPONSOR_MAX_RC_PER_OP` / `OSP_SPONSOR_DAILY_OPS` rather than running dry: when the balance
cannot cover `rc_limit`, `/v1/prepare` lowers `rc_limit` to the available RC and broadcasts start
failing, which clients see as refusals and route around (another sponsor or self-pay).

## Layout

```
src/config.ts    environment parsing, deployment manifest lookup
src/policy.ts    default allowlist, override parsing, actor-field map, discovery policy
src/validate.ts  pure transaction/operation validation with typed refusals
src/quota.ts     node:sqlite daily usage + in-memory burst window + utilization
src/server.ts    SponsorService + Fastify routes
src/register.ts  on-chain set_sponsor (self-paid, best effort)
src/main.ts      entry point
src/__tests__/   offline fixtures (synthetic deployment, fake provider, inject fetch)
```
