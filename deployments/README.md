# Deployment manifests

`<network>.json` is written by `scripts/deploy-contracts.ts` and consumed by the SDK
(`@osp/sdk` `loadDeployment`), the indexer, the sponsor, the web client and the extension.
Never edit by hand except to add `indexers` / `sponsors` entries.

```json
{
  "network": "harbinger",
  "chainId": "EiBncD4pKRIQWco_WRqo5Q-xnXR7JuO3PtZv983mKdKHSQ==",
  "rpc": ["https://harbinger-api.koinos.io", "https://api.harbinger.koinos.pro"],
  "protocolVersion": 1,
  "deployedAt": "2026-09-05T00:00:00Z",
  "deployer": "1Deployer...",
  "contracts": {
    "identity":      { "address": "1...", "txId": "0x1220...", "block": "123", "wasmSha256": "...", "abiSha256": "...", "rcUsed": "..." },
    "relationships": { "address": "1...", "txId": "0x1220...", "block": "123", "wasmSha256": "...", "abiSha256": "...", "rcUsed": "..." },
    "publications":  { "address": "1...", "txId": "0x1220...", "block": "123", "wasmSha256": "...", "abiSha256": "...", "rcUsed": "..." },
    "communities":   { "address": "1...", "txId": "0x1220...", "block": "123", "wasmSha256": "...", "abiSha256": "...", "rcUsed": "..." },
    "sponsorship":   { "address": "1...", "txId": "0x1220...", "block": "123", "wasmSha256": "...", "abiSha256": "...", "rcUsed": "..." },
    "registry":      { "address": "1...", "txId": "0x1220...", "block": "123", "wasmSha256": "...", "abiSha256": "...", "rcUsed": "..." }
  },
  "startHeight": "123",
  "indexers": ["https://indexer.example.org"],
  "sponsors": ["https://sponsor.example.org"]
}
```

* `startHeight` is the block height of the first deployment transaction; indexers replay from it.
* `chainId` is recorded from `chain.get_chain_id` at deploy time. The value above is the Harbinger
  id documented on docs.koinos.io; the deploy script warns if the RPC reports a different id.
* `harbinger.json` appears in this directory once the **deploy-testnet** workflow (or
  `npm run deploy:testnet`) has run. `localnet.json` is produced by `npm run deploy:localnet`
  against a local-koinos devnet and is gitignored.
