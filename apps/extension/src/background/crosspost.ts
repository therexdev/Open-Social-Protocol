/**
 * Cross-post orchestrator (spec section 7). Persists one StoredCrossPost per attempt in
 * chrome.storage.local and drives it with the SDK's pure `transition` / `retryPlan` and the
 * `Reconciler` lookup. Rules it enforces:
 *
 *  - a draft is published only through `confirm` (the side panel's explicit confirmation);
 *  - the idempotency key is derived from the author and the persisted attempt id, so a retry can
 *    never create a second Koinos post;
 *  - an unknown outcome is looked up on chain (then the indexer) before anything is re-sent; the
 *    content hash, expected post id and transaction id of the attempt are kept so the lookup can
 *    match it and the transaction id survives reconciliation;
 *  - host-side publication is manual for adapters that cannot publish programmatically
 *    (Facebook): the host side stays pending until the user reports it with the post link (or as
 *    failed); retries never touch the host;
 *  - once both sides are known the signed proof manifest is recorded (best effort, retryable);
 *    Koinos-only attempts (side panel, shared page) never record a proof.
 */
import { Reconciler, idempotencyKey, newCrossPostRecord, retryPlan, transition, type CrossPostRecord, type PostRef, type ValueResult } from "@osp/sdk";
import { fromHex, toHex } from "../shared/bytes";
import type { Adapter, CreatePayload, ProposePayload, StoredCrossPost } from "../shared/protocol";
import { STALE_SUBMITTING_MS, explain, hostRefProblem, needsProof } from "../shared/queue";
import type { KeyValueArea } from "../shared/storage";
import { classifySubmitError, type ProofResult, type PublishOutcome } from "./publish";

export const CROSSPOSTS_KEY = "osp.crossposts";
export const MAX_RECORDS = 200;

interface CrossPostFile {
  version: 1;
  records: StoredCrossPost[];
}

export interface CrossPostDeps {
  storage: KeyValueArea;
  now?: () => number;
  /** The signed-in account; undefined while locked. */
  account: () => Promise<string | undefined>;
  publishKoinos: (record: StoredCrossPost) => Promise<PublishOutcome>;
  lookupChain: (author: string, key: Uint8Array) => Promise<ValueResult<PostRef> | undefined>;
  /** Optional indexer lookup (may lag the chain); matches the record's content hash / expected post id. */
  lookupIndexer?: (author: string, record: StoredCrossPost) => Promise<{ postId: string; txId?: string; blockHeight?: string } | null>;
  recordProof?: (record: StoredCrossPost) => Promise<ProofResult>;
  onChange?: (records: StoredCrossPost[]) => unknown;
}

export class CrossPostError extends Error {
  override name = "CrossPostError";
}

function baseRecord(record: StoredCrossPost): CrossPostRecord {
  const { idempotencyKey: key, attemptId, hostSite, audience, state, hostStatus, koinosStatus, hostRef, koinosTxId, postId, lastError, updatedAt } = record;
  return {
    idempotencyKey: key,
    attemptId,
    ...(hostSite !== undefined && { hostSite }),
    audience,
    state,
    hostStatus,
    koinosStatus,
    ...(hostRef !== undefined && { hostRef }),
    ...(koinosTxId !== undefined && { koinosTxId }),
    ...(postId !== undefined && { postId }),
    ...(lastError !== undefined && { lastError }),
    updatedAt,
  };
}

function merge(record: StoredCrossPost, next: CrossPostRecord): StoredCrossPost {
  const merged: StoredCrossPost = { ...record, ...next };
  if (next.hostRef === undefined) delete merged.hostRef;
  if (next.koinosTxId === undefined) delete merged.koinosTxId;
  if (next.postId === undefined) delete merged.postId;
  if (next.lastError === undefined) delete merged.lastError;
  return merged;
}

/**
 * After a lookup confirmed the post id the attempt expected, the attempt's transaction id is the
 * post's transaction id (the node accepted it; only the answer was lost).
 */
function adoptPendingTx(stored: StoredCrossPost, current: CrossPostRecord): CrossPostRecord {
  if (current.koinosStatus === "ok" && current.koinosTxId === undefined && stored.pendingTxId && stored.expectedPostId && current.postId === stored.expectedPostId) {
    return { ...current, koinosTxId: stored.pendingTxId };
  }
  return current;
}

export class CrossPostOrchestrator {
  private readonly now: () => number;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: CrossPostDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** Serializes every mutation so concurrent messages cannot lose updates. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<CrossPostFile> {
    const file = await this.deps.storage.get<CrossPostFile>(CROSSPOSTS_KEY);
    return file && file.version === 1 && Array.isArray(file.records) ? file : { version: 1, records: [] };
  }

  private async save(file: CrossPostFile): Promise<void> {
    if (file.records.length > MAX_RECORDS) {
      // drop the oldest finished records first
      const finished = file.records.filter((r) => r.state === "succeeded").sort((a, b) => a.updatedAt - b.updatedAt);
      const drop = new Set(finished.slice(0, file.records.length - MAX_RECORDS).map((r) => r.attemptId));
      file.records = file.records.filter((r) => !drop.has(r.attemptId));
    }
    await this.deps.storage.set(CROSSPOSTS_KEY, file);
    await this.deps.onChange?.(file.records);
  }

  private async update(file: CrossPostFile, record: StoredCrossPost): Promise<StoredCrossPost> {
    const index = file.records.findIndex((r) => r.attemptId === record.attemptId);
    if (index >= 0) file.records[index] = record;
    else file.records.unshift(record);
    await this.save(file);
    return record;
  }

  async list(): Promise<StoredCrossPost[]> {
    const file = await this.load();
    return file.records.slice().sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(attemptId: string): Promise<StoredCrossPost | undefined> {
    return (await this.load()).records.find((r) => r.attemptId === attemptId);
  }

  private async fresh(input: { attemptId: string; adapter: Adapter; hostSite?: "facebook"; audience: number; text: string; url?: string; title?: string; hostSubmitted?: boolean }): Promise<StoredCrossPost> {
    const account = await this.deps.account();
    const key = account ? toHex(idempotencyKey(account, fromHex(input.attemptId))) : "";
    const record = newCrossPostRecord({ idempotencyKey: key, attemptId: input.attemptId, hostSite: input.hostSite, audience: input.audience, now: this.now() });
    return {
      ...record,
      adapter: input.adapter,
      ...(account && { author: account }),
      text: input.text,
      ...(input.url && { url: input.url }),
      ...(input.title && { title: input.title }),
      ...(input.hostSubmitted && { hostSubmitted: true }),
      createdAt: this.now(),
    };
  }

  /** A draft proposed by a host adapter (content script). Idempotent per attempt id. */
  propose(payload: ProposePayload): Promise<StoredCrossPost> {
    return this.run(async () => {
      const file = await this.load();
      const existing = file.records.find((r) => r.attemptId === payload.attemptId);
      if (existing) return existing;
      const record = await this.fresh({
        attemptId: payload.attemptId,
        adapter: payload.hostSite,
        hostSite: payload.hostSite,
        audience: 0,
        text: payload.text,
        url: payload.url,
        hostSubmitted: payload.submitted,
      });
      return this.update(file, record);
    });
  }

  /** A draft created in the side panel (composer or "share current page"). */
  create(payload: CreatePayload, attemptId: string): Promise<StoredCrossPost> {
    return this.run(async () => {
      const file = await this.load();
      const existing = file.records.find((r) => r.attemptId === attemptId);
      if (existing) return existing;
      const record = await this.fresh({ attemptId, adapter: payload.adapter, audience: payload.audience, text: payload.text, url: payload.url, title: payload.title });
      return this.update(file, record);
    });
  }

  /**
   * The explicit confirmation: the only path that publishes a draft. The host side of a Facebook
   * proposal stays pending: pressing Post on Facebook does not prove Facebook published it, so
   * the user reports the outcome (with the post link) from the queue.
   */
  confirm(attemptId: string, options: { audience?: number } = {}): Promise<StoredCrossPost> {
    return this.run(async () => {
      const file = await this.load();
      const record = file.records.find((r) => r.attemptId === attemptId);
      if (!record) throw new CrossPostError("Unknown attempt.");
      if (record.state !== "draft") throw new CrossPostError(`This attempt is ${record.state}; use retry or reconcile instead.`);
      const account = await this.deps.account();
      if (!account) throw new CrossPostError("Unlock your account first.");
      if (record.author && record.author !== account) throw new CrossPostError("This draft belongs to another account.");
      let prepared: StoredCrossPost = {
        ...record,
        author: account,
        audience: options.audience ?? record.audience,
        idempotencyKey: toHex(idempotencyKey(account, fromHex(record.attemptId))),
      };
      const current = transition(baseRecord(prepared), { type: "retry", at: this.now() });
      prepared = await this.update(file, merge(prepared, current));
      return this.publish(file, prepared);
    });
  }

  private reconciler(record: StoredCrossPost): Reconciler {
    const lookupIndexer = this.deps.lookupIndexer;
    return new Reconciler({
      chain: { getPostByIdempotencyKey: (args) => this.deps.lookupChain(args.author, args.idempotency_key) },
      ...(lookupIndexer && { indexer: { findByIdempotencyKey: (author: string) => lookupIndexer(author, record) } }),
      now: this.now,
    });
  }

  private async publish(file: CrossPostFile, record: StoredCrossPost): Promise<StoredCrossPost> {
    let current = baseRecord(record);
    let extra: Partial<StoredCrossPost> = {};
    let known: StoredCrossPost = record;
    try {
      const outcome = await this.deps.publishKoinos(record);
      current = transition(current, { type: "koinosSucceeded", txId: outcome.txId, postId: outcome.postId, at: this.now() });
      extra = { contentHash: outcome.contentHash, versionNumber: 1, sequence: outcome.sequence, epoch: outcome.epoch, expectedPostId: outcome.postId };
    } catch (error) {
      const failure = classifySubmitError(error);
      if (failure.attempt) {
        // The attempt was built and sent: keep what identifies it so a lookup can match it.
        const { contentHash, postId, sequence, epoch, transactionId } = failure.attempt;
        extra = { contentHash, versionNumber: 1, sequence, epoch, expectedPostId: postId, ...(failure.kind === "unknown" && transactionId && { pendingTxId: transactionId }) };
        known = { ...record, ...extra };
      }
      if (failure.kind === "unknown") {
        current = transition(current, { type: "koinosUnknown", error: failure.message, at: this.now() });
      } else if (failure.kind === "duplicate") {
        current = transition(current, { type: "koinosFailed", error: failure.message, at: this.now() });
        current = adoptPendingTx(known, await this.reconciler(known).lookup(current, record.author ?? ""));
      } else {
        current = transition(current, { type: "koinosFailed", error: failure.message, at: this.now() });
      }
    }
    let next = merge({ ...record, ...extra }, current);
    if (next.koinosStatus === "ok") {
      delete next.text;
      delete next.pendingTxId;
    } else if (!extra.pendingTxId) {
      delete next.pendingTxId;
    }
    next = await this.update(file, next);
    return this.maybeProof(file, next);
  }

  private async maybeProof(file: CrossPostFile, record: StoredCrossPost): Promise<StoredCrossPost> {
    if (!needsProof(record) || !this.deps.recordProof) return record;
    try {
      const proof = await this.deps.recordProof(record);
      const next: StoredCrossPost = {
        ...record,
        ...(record.koinosTxId === undefined && proof.koinosTxId && { koinosTxId: proof.koinosTxId }),
        proof: { manifestHash: proof.manifestHash, txId: proof.txId, outcome: proof.outcome, recordedAt: this.now() },
      };
      delete next.proofError;
      return this.update(file, next);
    } catch (error) {
      return this.update(file, { ...record, proofError: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Retries whatever is missing; an unknown Koinos outcome is looked up first, never re-sent blindly. */
  retry(attemptId: string): Promise<StoredCrossPost> {
    return this.run(async () => {
      const file = await this.load();
      const record = file.records.find((r) => r.attemptId === attemptId);
      if (!record) throw new CrossPostError("Unknown attempt.");
      if (!explain(record, this.now()).actions.includes("retry") && record.state !== "unknown") {
        throw new CrossPostError(`Retry is not available while the attempt is ${record.state}.`);
      }
      const account = await this.deps.account();
      if (!account) throw new CrossPostError("Unlock your account first.");
      if (record.author && record.author !== account) throw new CrossPostError("This attempt belongs to another account.");
      let current = baseRecord(record);
      if (current.koinosStatus === "unknown") {
        current = adoptPendingTx(record, await this.reconciler(record).lookup(current, account));
        if (current.koinosStatus === "ok" || current.state === "reconcile_required") {
          return this.maybeProof(file, await this.update(file, this.settle(record, current)));
        }
      }
      const plan = retryPlan(current);
      current = transition(current, { type: "retry", at: this.now() });
      const prepared = await this.update(file, merge(record, current));
      if (plan.koinos) {
        if (!prepared.text) throw new CrossPostError("The draft text is gone; discard this attempt and post again.");
        return this.publish(file, prepared);
      }
      // Host side is manual (mark it from the queue); nothing else to do.
      return prepared;
    });
  }

  /** Merges a lookup result; a confirmed Koinos side drops the draft text and the pending transaction id. */
  private settle(record: StoredCrossPost, current: CrossPostRecord): StoredCrossPost {
    const next = merge(record, current);
    if (next.koinosStatus === "ok") {
      delete next.text;
      delete next.pendingTxId;
    }
    return next;
  }

  /** Chain (then indexer) lookup only. Safe at any time; never publishes. */
  reconcile(attemptId: string): Promise<StoredCrossPost> {
    return this.run(async () => {
      const file = await this.load();
      const record = file.records.find((r) => r.attemptId === attemptId);
      if (!record) throw new CrossPostError("Unknown attempt.");
      const account = record.author ?? (await this.deps.account());
      if (!account) throw new CrossPostError("Unlock your account first.");
      let current = baseRecord({ ...record, idempotencyKey: record.idempotencyKey || toHex(idempotencyKey(account, fromHex(record.attemptId))) });
      if (current.state === "submitting" && this.now() - current.updatedAt > STALE_SUBMITTING_MS && current.koinosStatus === "pending") {
        current = transition(current, { type: "koinosUnknown", error: "interrupted before the node answered", at: this.now() });
      }
      if (current.state === "draft") return record;
      current = adoptPendingTx(record, await this.reconciler(record).lookup(current, account));
      const next = await this.update(file, this.settle({ ...record, author: account, idempotencyKey: current.idempotencyKey }, current));
      return this.maybeProof(file, next);
    });
  }

  /**
   * The user reports the host side (Facebook publishes through its own UI). "posted" needs the
   * link to the host post: it becomes `hostRef` and the proof manifest's `external_ref`.
   */
  markHost(attemptId: string, outcome: "posted" | "failed", detail?: string): Promise<StoredCrossPost> {
    return this.run(async () => {
      const file = await this.load();
      const record = file.records.find((r) => r.attemptId === attemptId);
      if (!record) throw new CrossPostError("Unknown attempt.");
      if (record.hostStatus === "not_required") throw new CrossPostError("This attempt has no host side.");
      if (record.state === "draft") throw new CrossPostError("Confirm the attempt first.");
      let event;
      if (outcome === "posted") {
        const problem = hostRefProblem(record, detail);
        if (problem) throw new CrossPostError(problem);
        event = { type: "hostSucceeded" as const, hostRef: detail as string, at: this.now() };
      } else {
        event = { type: "hostFailed" as const, error: detail || "The host did not publish the post.", at: this.now() };
      }
      const next = await this.update(file, merge(record, transition(baseRecord(record), event)));
      return this.maybeProof(file, next);
    });
  }

  recordProof(attemptId: string): Promise<StoredCrossPost> {
    return this.run(async () => {
      const file = await this.load();
      const record = file.records.find((r) => r.attemptId === attemptId);
      if (!record) throw new CrossPostError("Unknown attempt.");
      if (!needsProof(record)) throw new CrossPostError("Nothing to record for this attempt.");
      if (!this.deps.recordProof) throw new CrossPostError("Proof recording is not available.");
      return this.maybeProof(file, record);
    });
  }

  discard(attemptId: string): Promise<void> {
    return this.run(async () => {
      const file = await this.load();
      const record = file.records.find((r) => r.attemptId === attemptId);
      if (!record) return;
      const inFlight = record.state === "submitting" && record.koinosStatus === "pending" && this.now() - record.updatedAt <= STALE_SUBMITTING_MS;
      if (inFlight) throw new CrossPostError("Wait for the submission to finish.");
      file.records = file.records.filter((r) => r.attemptId !== attemptId);
      await this.save(file);
    });
  }

  /** Periodic maintenance: stale submissions become unknown and unknown outcomes are looked up. */
  async sweep(): Promise<void> {
    const records = await this.list();
    for (const record of records) {
      const stale = record.state === "submitting" && this.now() - record.updatedAt > STALE_SUBMITTING_MS && record.koinosStatus === "pending";
      if (record.state === "unknown" || stale) {
        try {
          await this.reconcile(record.attemptId);
        } catch {
          // lookups are best effort here; the queue shows the state
        }
      }
    }
  }
}
