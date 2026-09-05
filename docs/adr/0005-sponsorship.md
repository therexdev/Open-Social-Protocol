# ADR 0005: Mana sponsorship as a replaceable payer service

Status: accepted (2026-09)

## Decision
* Users sign as payee (their nonce), sponsors co-sign as payer. The sponsor service validates
  the complete transaction (chain id, allowlisted `(contract, entry_point)` pairs, byte and RC
  ceilings, per-user quotas) and appends its signature without changing operations.
* Sponsor discovery is on chain (`sponsorship.set_sponsor`) and over HTTPS
  (`/.well-known/osp-sponsor.json`). Clients keep an ordered list of approved sponsors and
  fall back to self-pay.
* Per-user grants and revocations are prospective and on chain; refusals are categorised and
  aggregate utilization is published.
* A contract-account payer with an `authorize` entry point (smart-wallet sponsor) is a
  documented future option; the pilot uses a hot-key service for operational simplicity.

## Consequences
No sponsor monopoly; the official sponsor can be turned off without breaking the protocol;
abuse is bounded by quotas and RC ceilings.
