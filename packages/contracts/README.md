# @osp/contracts

Six AssemblyScript contracts for Koinos, one directory each: `identity`, `relationships`,
`publications`, `communities`, `sponsorship`, `registry`. Each directory has its own README
with methods, state spaces, limits, events and design notes.

```sh
npm run build -w packages/contracts        # release WASM + Koinos ABIs into build/release/
npm run build:debug -w packages/contracts  # debug build (source maps)
npm test -w packages/contracts             # as-pect 8 + Koinos mock VM suites for every contract
node scripts/build.mjs release identity    # one contract
node scripts/test.mjs identity             # one contract's tests
```

Pipeline (`scripts/build.mjs`): copy the schema from `packages/proto/osp/<name>.proto` (plus
dependency schemas) -> `@koinos/as-proto-gen` message classes -> `@koinos/as-gen` entry-point
dispatch (`assembly/index.ts`) -> Koinos-format ABI (`abi/<name>.abi`, descriptor set with imports)
-> `asc` compile. Shared helpers in `common/assembly/` (cross-contract actor resolution, byte
utilities, mock-VM test setup) are copied into each contract's `assembly/common/` at build time.

Notes that matter on chain:

* Every contract enlarges the `@koinos/sdk-as` system-call buffer to 32 KiB at module
  initialization (call arguments and database reads pass through it; the default 1 KiB would
  reject 4 KiB envelopes and 16 KiB key packages).
* `System.hash` returns a 34-byte multihash; the publications contract strips the prefix so
  post ids and content hashes are raw 32-byte digests, matching `@osp/sdk`.
* Authorization follows `docs/adr/0003-authority-model.md`: dependent contracts resolve the
  required signer via `identity.resolve_actor` and check that signer's `contract_call` authority
  in the top-level call.

Deployment: `scripts/deploy-contracts.ts` at the repository root (see `docs/deploy-testnet.md`).
