/**
 * State hash (ADR 0006): a deterministic hash chain over the decoded protocol events of every
 * block, so independent indexers can compare themselves at any height.
 *
 *   stateHash(height) = sha256(stateHash(height - 1) || utf8(canonicalJson(events)))
 *
 * where `stateHash(startHeight - 1)` is empty (zero bytes) and `events` is the block's decoded
 * protocol events in canonical order, each rendered as
 * `{ height, blockId, txIndex, txId, sequence, contract, name, data, impacted }` with every
 * `bytes` value (envelopes, hashes, ids) as base64url and uint64 values as decimal strings
 * (exactly what `GET /v1/events` returns). Canonical JSON: keys sorted, no whitespace.
 * Hashes are lowercase hex (64 chars).
 */
import { createHash } from "node:crypto";
import { canonicalJson, toBase64url } from "@osp/sdk";

/** JSON-friendly form of an event payload: Uint8Array -> base64url, everything else unchanged. */
export function toJsonValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return toBase64url(value);
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) out[key] = toJsonValue(item);
    }
    return out;
  }
  return value;
}

/** One decoded event as it enters the hash and the `/v1/events` route. */
export interface EventView {
  height: string;
  blockId: string;
  txIndex: number;
  txId: string;
  sequence: number;
  contract: string;
  name: string;
  data: unknown;
  impacted: string[];
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Uint8Array.from(Buffer.from(clean, "hex"));
}

/** Computes the state hash of a block from the previous hash (hex, or undefined for the first block). */
export function computeStateHash(previous: string | undefined, events: EventView[]): string {
  const hash = createHash("sha256");
  if (previous) hash.update(hexToBytes(previous));
  hash.update(Buffer.from(canonicalJson(events), "utf8"));
  return hash.digest("hex");
}
