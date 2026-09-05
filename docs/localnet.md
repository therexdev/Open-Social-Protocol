# Local Koinos devnet (experimental)

The deployment script supports a `localnet` preset (`http://localhost:8080`, deployer defaults to
the `local-koinos` "bob" wallet). Running a devnet requires Docker and is not exercised in CI:

1. Follow the Koinos node quick start (https://docs.koinos.io/validators/guides/running-a-node/)
   or use the `local-koinos` npm package's docker-compose setup with a federated block producer.
2. Fund the deployer (the devnet genesis/koin wallets can transfer tKOIN).
3. `OSP_CONTRACT_SEED="dev seed" npm run deploy:localnet`
4. `OSP_NETWORK=localnet npm run indexer`, `OSP_NETWORK=localnet OSP_SPONSOR_WIF=... npm run sponsor`,
   `VITE_OSP_NETWORK=localnet npm run web`.

Contract behavior is fully covered by mock-VM unit tests, and `scripts/deploy-contracts.ts --dry-run`
measures Mana against the real testnet without committing state, so a devnet is optional.
