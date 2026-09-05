# ADR 0004: Encryption suite for the pilot

Status: accepted for testnet pilot; requires independent review before mainnet

## Decision
* Suite 1: XChaCha20-Poly1305 content encryption with a random per-post content key; the content
  key is wrapped under an audience epoch key; epoch keys are sealed per recipient with
  X25519 + HKDF-SHA256 + XChaCha20-Poly1305 (`@noble/ciphers`, `@noble/curves`, `@noble/hashes`).
* Associated data binds protocol version, chain id, author, post id, audience, epoch and
  version number (`osp.envelope.aad`).
* Audience membership changes advance the epoch; per-member sealing is linear (acceptable for
  pilot audiences, see whitepaper section 5 for the key-tree follow-up).
* Domain separators on every hash/AAD; canonical protobuf; no maps.

## Consequences
Simple to implement across browser, extension and Node; explicit revocation limits; a larger
audience construction (tree/broadcast encryption) is deferred to Phase 2 per the roadmap.
