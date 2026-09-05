/**
 * Cross-platform reconciliation (spec section 7): a persisted record per cross-post attempt,
 * a pure transition function and a Reconciler that resolves unknown Koinos outcomes through
 * `get_post_by_idempotency_key` (and optionally an indexer) before any retry. A Koinos
 * publication is never repeated once a post id is known.
 */
import { bytesEqual, toHex } from "./encoding.js";
import type { PostRef, ValueResult } from "./client/types.js";

export type CrossPostState = "draft" | "submitting" | "succeeded" | "partial" | "unknown" | "failed" | "reconcile_required";

/** Per-side progress. `not_required` marks a Koinos-only attempt with no host site. */
export type SideStatus = "pending" | "ok" | "failed" | "unknown" | "not_required";

export interface CrossPostRecord {
  /** hex of the 16-byte idempotency key. */
  idempotencyKey: string;
  /** hex of the 16-byte client attempt id. */
  attemptId: string;
  /** Host site adapter, e.g. "facebook"; empty/undefined for Koinos-only attempts. */
  hostSite?: string;
  audience: number;
  state: CrossPostState;
  hostStatus: SideStatus;
  koinosStatus: SideStatus;
  hostRef?: string;
  koinosTxId?: string;
  /** hex of the 32-byte post id. */
  postId?: string;
  lastError?: string;
  /** ms since epoch. */
  updatedAt: number;
}

export type ReconcileEvent =
  | { type: "retry"; at?: number }
  | { type: "hostSucceeded"; hostRef: string; at?: number }
  | { type: "hostFailed"; error: string; at?: number }
  | { type: "koinosSucceeded"; txId: string; postId: string; at?: number }
  | { type: "koinosFailed"; error: string; at?: number }
  | { type: "koinosUnknown"; error?: string; at?: number }
  | { type: "lookupFound"; postId: string; txId?: string; at?: number }
  | { type: "lookupMissing"; at?: number };

export interface NewRecordInput {
  idempotencyKey: Uint8Array | string;
  attemptId: Uint8Array | string;
  hostSite?: string;
  audience: number;
  now?: number;
}

function hexOf(value: Uint8Array | string): string {
  return typeof value === "string" ? value.toLowerCase() : toHex(value);
}

/** A fresh `draft` record. */
export function newCrossPostRecord(input: NewRecordInput): CrossPostRecord {
  const hostSite = input.hostSite && input.hostSite.length > 0 ? input.hostSite : undefined;
  return {
    idempotencyKey: hexOf(input.idempotencyKey),
    attemptId: hexOf(input.attemptId),
    ...(hostSite !== undefined && { hostSite }),
    audience: input.audience,
    state: "draft",
    hostStatus: hostSite ? "pending" : "not_required",
    koinosStatus: "pending",
    updatedAt: input.now ?? Date.now(),
  };
}

function deriveState(record: CrossPostRecord): CrossPostState {
  const host = record.hostStatus;
  const koinos = record.koinosStatus;
  if (koinos === "unknown") return "unknown";
  const hostDone = host === "ok" || host === "not_required";
  if (hostDone && koinos === "ok") return "succeeded";
  if ((hostDone && koinos === "failed") || (koinos === "ok" && host === "failed")) return "partial";
  if (host === "failed" && koinos === "failed") return "failed";
  return "submitting";
}

function conflict(record: CrossPostRecord, at: number, reason: string): CrossPostRecord {
  return { ...record, state: "reconcile_required", lastError: reason, updatedAt: at };
}

function finish(record: CrossPostRecord, at: number): CrossPostRecord {
  return { ...record, state: deriveState(record), updatedAt: at };
}

/**
 * Pure state transition. Never mutates its input. Conflicting facts (a different post id or
 * host ref than already recorded, a chain lookup that contradicts a recorded success) move
 * the record to `reconcile_required`, which only manual intervention leaves.
 */
export function transition(record: CrossPostRecord, event: ReconcileEvent): CrossPostRecord {
  const at = event.at ?? Date.now();
  if (record.state === "reconcile_required") return record;

  switch (event.type) {
    case "retry": {
      if (record.state === "succeeded") return record;
      if (record.state === "unknown") {
        return { ...record, lastError: "lookup required before retry", updatedAt: at };
      }
      const next: CrossPostRecord = { ...record, updatedAt: at };
      delete next.lastError;
      if (next.hostStatus === "failed") next.hostStatus = "pending";
      if (next.koinosStatus === "failed") next.koinosStatus = "pending";
      return { ...next, state: "submitting" };
    }
    case "hostSucceeded": {
      if (record.hostStatus === "not_required") return conflict(record, at, "host result for a Koinos-only attempt");
      if (record.hostRef !== undefined && record.hostRef !== event.hostRef) {
        return conflict(record, at, `host ref ${event.hostRef} conflicts with ${record.hostRef}`);
      }
      return finish({ ...record, hostStatus: "ok", hostRef: event.hostRef }, at);
    }
    case "hostFailed": {
      if (record.hostStatus === "not_required") return conflict(record, at, "host result for a Koinos-only attempt");
      if (record.hostStatus === "ok") return record;
      return finish({ ...record, hostStatus: "failed", lastError: event.error }, at);
    }
    case "koinosSucceeded":
    case "lookupFound": {
      const postId = event.postId.toLowerCase();
      if (record.postId !== undefined && record.postId !== postId) {
        return conflict(record, at, `post id ${postId} conflicts with ${record.postId}`);
      }
      const next: CrossPostRecord = { ...record, koinosStatus: "ok", postId };
      if (event.txId !== undefined) next.koinosTxId = event.txId;
      if (event.type === "koinosSucceeded") delete next.lastError;
      return finish(next, at);
    }
    case "koinosFailed": {
      if (record.koinosStatus === "ok") return record;
      return finish({ ...record, koinosStatus: "failed", lastError: event.error }, at);
    }
    case "koinosUnknown": {
      if (record.koinosStatus === "ok") return record;
      const next: CrossPostRecord = { ...record, koinosStatus: "unknown" };
      if (event.error !== undefined) next.lastError = event.error;
      return finish(next, at);
    }
    case "lookupMissing": {
      if (record.koinosStatus === "ok") {
        return conflict(record, at, "chain lookup found no post for an idempotency key recorded as succeeded");
      }
      if (record.koinosStatus === "unknown") {
        return finish({ ...record, koinosStatus: "failed", lastError: "not found on chain; safe to retry" }, at);
      }
      return { ...record, updatedAt: at };
    }
    default:
      return record;
  }
}

/** Which sides a retry must (re)publish. Koinos is never republished once a post id is known. */
export function retryPlan(record: CrossPostRecord): { koinos: boolean; host: boolean } {
  const koinos = record.postId === undefined && record.koinosStatus !== "ok" && record.koinosStatus !== "unknown";
  const host = record.hostStatus !== "not_required" && record.hostStatus !== "ok";
  return { koinos, host };
}

/** Minimal chain lookup used by the Reconciler (`ProtocolClient.reads.publications.get_post_by_idempotency_key`). */
export interface ChainLookup {
  getPostByIdempotencyKey(args: { author: string; idempotency_key: Uint8Array }): Promise<ValueResult<PostRef> | undefined>;
}

/** Optional indexer lookup; returns null when the indexer knows nothing (it may lag the chain). */
export interface IndexerLookup {
  findByIdempotencyKey(author: string, idempotencyKeyHex: string): Promise<{ postId: string; txId?: string } | null>;
}

export interface ReconcilerOptions {
  chain: ChainLookup;
  indexer?: IndexerLookup;
  now?: () => number;
}

export interface RetryActions {
  /** Publishes on Koinos; must reuse the record's idempotency key. */
  publishKoinos?: () => Promise<{ txId: string; postId: Uint8Array | string }>;
  /** Publishes on the host site. */
  publishHost?: () => Promise<{ hostRef: string }>;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export class Reconciler {
  private readonly chain: ChainLookup;
  private readonly indexer: IndexerLookup | undefined;
  private readonly now: () => number;

  constructor(options: ReconcilerOptions) {
    this.chain = options.chain;
    this.indexer = options.indexer;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Resolves a record whose Koinos outcome is unknown (or failed with a duplicate-key error):
   * chain first (authoritative), then the indexer. Returns the updated record.
   */
  async lookup(record: CrossPostRecord, author: string): Promise<CrossPostRecord> {
    const key = hexToBytes(record.idempotencyKey);
    const at = this.now();
    const found = await this.chain.getPostByIdempotencyKey({ author, idempotency_key: key });
    const postId = found?.value?.post_id;
    if (postId && postId.length > 0) {
      let txId: string | undefined;
      if (this.indexer) {
        const hit = await this.indexer.findByIdempotencyKey(author, record.idempotencyKey);
        if (hit && bytesEqual(hexToBytes(hit.postId), postId)) txId = hit.txId;
      }
      return transition(record, { type: "lookupFound", postId: toHex(postId), ...(txId !== undefined && { txId }), at });
    }
    if (this.indexer) {
      const hit = await this.indexer.findByIdempotencyKey(author, record.idempotencyKey);
      if (hit) {
        return transition(record, { type: "lookupFound", postId: hit.postId, ...(hit.txId !== undefined && { txId: hit.txId }), at });
      }
    }
    return transition(record, { type: "lookupMissing", at });
  }

  /**
   * Retries whatever is missing, after resolving an unknown Koinos outcome. Records in
   * `reconcile_required` or `succeeded` are returned unchanged.
   */
  async retry(record: CrossPostRecord, author: string, actions: RetryActions): Promise<CrossPostRecord> {
    let current = record;
    if (current.state === "reconcile_required" || current.state === "succeeded") return current;
    if (current.koinosStatus === "unknown") current = await this.lookup(current, author);
    if (current.state === "reconcile_required" || current.state === "succeeded") return current;
    const plan = retryPlan(current);
    current = transition(current, { type: "retry", at: this.now() });
    if (plan.koinos) {
      if (!actions.publishKoinos) throw new Error("publishKoinos action required");
      try {
        const result = await actions.publishKoinos();
        current = transition(current, { type: "koinosSucceeded", txId: result.txId, postId: hexOf(result.postId), at: this.now() });
      } catch (error) {
        const message = (error as Error).message ?? String(error);
        if (/duplicate idempotency key/i.test(message)) {
          current = transition(current, { type: "koinosFailed", error: message, at: this.now() });
          current = await this.lookup(current, author);
        } else if (/timeout|timed out|deadline|network/i.test(message)) {
          current = transition(current, { type: "koinosUnknown", error: message, at: this.now() });
        } else {
          current = transition(current, { type: "koinosFailed", error: message, at: this.now() });
        }
      }
    }
    if (plan.host) {
      if (!actions.publishHost) throw new Error("publishHost action required");
      try {
        const result = await actions.publishHost();
        current = transition(current, { type: "hostSucceeded", hostRef: result.hostRef, at: this.now() });
      } catch (error) {
        current = transition(current, { type: "hostFailed", error: (error as Error).message ?? String(error), at: this.now() });
      }
    }
    return current;
  }
}
