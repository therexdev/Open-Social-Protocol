# ADR 0001: Monorepo layout, licensing and toolchain

Status: accepted (2026-09)

## Context
The proposal calls for four products (protocol, reference web client, browser extension,
replaceable infrastructure) that share schemas, cryptography and a client SDK, plus a
requirement that every component be independently replaceable and buildable.

## Decision
* One npm-workspaces monorepo: `packages/proto` (schemas + generated descriptors/ABIs),
  `packages/contracts` (AssemblyScript Koinos contracts), `packages/sdk` (TypeScript),
  `apps/web`, `apps/extension`, `apps/indexer`, `apps/sponsor`, `scripts/` (deployment),
  `deployments/` (published contract addresses per network), `docs/`.
* MIT license for everything. Trademark policy (name/logo) is a separate, later decision.
* Node 22 LTS; TypeScript 5.9; Vite 8 for the web and extension; Fastify 5 for services;
  Node's built-in `node:sqlite` for indexer/sponsor storage (no native build step);
  `koilib` for Koinos RPC/signing; `@noble/*` for cryptography (audited, pure JS, works in
  browsers, extension service workers and Node).
* The root `npm run build` builds only what a static host needs (proto, sdk, web) so the
  reference client can be built by Hostinger from GitHub without the contract toolchain.

## Consequences
Any package can be forked and operated independently; the SDK is the only shared runtime
dependency and it is conformance-tested against golden vectors.
