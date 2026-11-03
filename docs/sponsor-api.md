# Sponsor HTTP API (v1)

All responses are JSON. Errors use `{ "error": { "category": <string>, "message": <string>, "retryAfterSec"?: number, "logs"?: string[] } }`
with categories and HTTP statuses: `quota_exceeded` 429, `method_not_allowed` 403, `too_large` 413,
`chain_mismatch` 400, `invalid_signature` 400, `invalid_transaction` 400, `temporarily_unavailable` 503.
A broadcast whose outcome is unknown (RPC timeout) returns 200 with a receipt carrying `rpc_error`;
clients must treat it as an unknown outcome and reconcile (spec section 7), never re-submit.

## `GET /.well-known/osp-sponsor.json`
Signed discovery document:

```json
{
  "version": 1,
  "sponsor": "1Sponsor...",
  "network": { "chainId": "EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==", "rpc": ["https://testnet.koinosfoundation.org/jsonrpc"] },
  "policy": {
    "version": 1,
    "allowed": [{ "contract": "1Identity...", "entryPoints": [ ... ] }],
    "maxBytesPerOp": 6144,
    "maxRcPerOp": "200000000",
    "perUser": { "dailyOps": 200, "burstOps": 20, "burstWindowSec": 60 }
  },
  "signature": "<base64url secp256k1 signature over sha256(canonical JSON without signature)>"
}
```

## `POST /v1/sponsor`
Body: `{ "transaction": <koilib TransactionJson signed by the user with header.payer = sponsor, header.payee = user> }`.
The sponsor validates, appends its signature and broadcasts.
Response: `{ "transaction": <TransactionJson>, "receipt": <receipt> }`.

## `POST /v1/prepare`
Body: `{ "payee": "1User...", "operations": [ ... ] }`. Returns an unsigned transaction with
`header.payer` set to the sponsor, a fresh nonce for the payee, `rc_limit` and `chain_id`, so
clients that cannot query RPC directly can still build a valid transaction.

## `GET /v1/utilization`
Aggregate counters (accepted, refused by category, RC used) for the current and previous day.
No per-user data is exposed.


## Music batching (policy version 3)

Policy v3 keeps `maxRcPerOp` as the ceiling for one bounded work unit. Ordinary
operations use one unit. `publications.append_music_batch` uses one unit per
chunk (1–4 chunks, each at most 16 KiB). Client RC limits, sponsor validation and
paid upload quotas use the same unit count. A batch cannot mix in another
operation, skip indexes, use another reservation, or contain uncommitted bytes.
A four-chunk batch with the default limit has at most 8 Mana; an ordinary action
still has at most 2 Mana. This does not promise the action will fit if chain
resource prices rise.

The v3 sponsor defaults to 72 KiB argument bounds, within the upgraded
sponsorship registry's 96 KiB maximum. The signed discovery advertises policy
version 3 and `healthz.features.musicBatching = 1`. Old clients' ordinary methods
retain their previous one-unit behavior.
