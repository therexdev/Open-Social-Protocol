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
  "network": { "chainId": "EiB...", "rpc": ["https://harbinger-api.koinos.io"] },
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
