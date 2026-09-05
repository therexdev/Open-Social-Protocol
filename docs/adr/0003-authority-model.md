# ADR 0003: Authority classes, device keys and recovery

Status: accepted (2026-09)

## Context
Browser clients and the extension must never hold unrestricted wallet control. Koinos
accounts are keys, so "recovery" must be a protocol-level notion.

## Decision
* The identity contract tracks `owner` (initially the account itself). Administrative actions
  require the owner's signature.
* Expiring device/session keys with capability bits are authorized by the owner and stored
  on chain; they can publish/react/comment/manage relationships/moderate but never block,
  rotate keys, authorize devices, change recovery or move assets.
* Every mutating method in other contracts resolves the required signer through
  `identity.resolve_actor` and then requires that signer's `contract_call` authority on the
  transaction (checked in the top-level contract, keeping `@koinos/sdk-as` enhanced-security
  semantics).
* M-of-N guardians with a delay: recovery proposals accumulate approvals, activate after the
  delay, are cancelable by the current owner, and bump `device_epoch` so all devices are void.
* Encryption-key backup is separate from control recovery: the X25519 secret derives from the
  exported seed; replacing the owner key never reveals historical plaintext.

## Consequences
A stolen extension session can do bounded social damage until expiry/revocation; a lost owner
key is recoverable through guardians; the identity address is stable across recoveries.
