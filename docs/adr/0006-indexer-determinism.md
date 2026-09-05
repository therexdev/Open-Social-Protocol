# ADR 0006: Replayable indexer

Status: accepted (2026-09)

## Decision
* The indexer polls `chain.get_blocks` from a configured start height, filters events by the
  configured protocol contract addresses, decodes them with `@osp/proto` descriptors and applies
  projections in canonical order (height, transaction index, event sequence).
* Blocks above the last irreversible block stay in a reversible window; a block-id mismatch at
  a known height triggers rollback to the last consistent checkpoint and replay.
* Checkpoints store `(height, block_id, state_hash)`; `state_hash` is a deterministic hash over
  authoritative projections so two independent indexers can compare.
* Storage: `node:sqlite`; deleting the database file and restarting must reproduce the same
  projections and state hash.
* Never stores decrypted content; envelopes are opaque bytes.

## Consequences
The official indexer is replaceable and verifiable; feed ranking is a derived, non-canonical
projection separate from authoritative tables.
