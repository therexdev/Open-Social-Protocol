import { describe, expect, it } from "vitest";
import { newCrossPostRecord, Reconciler, retryPlan, transition, type CrossPostRecord, type ReconcileEvent } from "./reconcile.js";

const base = () => newCrossPostRecord({ idempotencyKey: new Uint8Array(16).fill(1), attemptId: new Uint8Array(16).fill(2), hostSite: "facebook", audience: 1, now: 1 });
const run = (record: CrossPostRecord, events: ReconcileEvent[]) => events.reduce((r, e) => transition(r, { ...e, at: 2 }), record);
const post = "aa".repeat(32);

describe("reconcile transitions (spec section 7)", () => {
  it("draft -> submitting -> succeeded", () => {
    const r = run(base(), [{ type: "retry" }, { type: "hostSucceeded", hostRef: "fb:1" }, { type: "koinosSucceeded", txId: "0x1", postId: post }]);
    expect(r.state).toBe("succeeded");
    expect(r.hostRef).toBe("fb:1");
    expect(r.postId).toBe(post);
    expect(r.koinosTxId).toBe("0x1");
  });

  it("host succeeds, Koinos fails -> partial; retry only Koinos", () => {
    const r = run(base(), [{ type: "retry" }, { type: "hostSucceeded", hostRef: "fb:1" }, { type: "koinosFailed", error: "rc" }]);
    expect(r.state).toBe("partial");
    expect(retryPlan(r)).toEqual({ koinos: true, host: false });
    const retried = transition(r, { type: "retry", at: 3 });
    expect(retried.state).toBe("submitting");
    expect(retried.hostRef).toBe("fb:1");
    expect(retried.koinosStatus).toBe("pending");
  });

  it("Koinos succeeds, host fails -> partial; never republish on Koinos", () => {
    const r = run(base(), [{ type: "retry" }, { type: "koinosSucceeded", txId: "0x1", postId: post }, { type: "hostFailed", error: "500" }]);
    expect(r.state).toBe("partial");
    expect(retryPlan(r)).toEqual({ koinos: false, host: true });
    const retried = transition(r, { type: "retry", at: 3 });
    expect(retried.postId).toBe(post);
    expect(retryPlan(retried).koinos).toBe(false);
  });

  it("unknown Koinos result requires a lookup before retry", () => {
    const r = run(base(), [{ type: "retry" }, { type: "koinosUnknown", error: "timeout" }]);
    expect(r.state).toBe("unknown");
    const blocked = transition(r, { type: "retry", at: 3 });
    expect(blocked.state).toBe("unknown");
    expect(blocked.lastError).toMatch(/lookup required/);
    const found = transition(r, { type: "lookupFound", postId: post, at: 3 });
    expect(found.postId).toBe(post);
    expect(found.state).toBe("submitting");
    const missing = transition(r, { type: "lookupMissing", at: 3 });
    expect(missing.koinosStatus).toBe("failed");
    expect(retryPlan(missing).koinos).toBe(true);
  });

  it("both fail -> failed; retry restarts both", () => {
    const r = run(base(), [{ type: "retry" }, { type: "hostFailed", error: "a" }, { type: "koinosFailed", error: "b" }]);
    expect(r.state).toBe("failed");
    expect(transition(r, { type: "retry", at: 3 }).state).toBe("submitting");
  });

  it("conflicting facts -> reconcile_required (absorbing)", () => {
    const ok = run(base(), [{ type: "retry" }, { type: "koinosSucceeded", txId: "0x1", postId: post }]);
    const conflict = transition(ok, { type: "lookupFound", postId: "bb".repeat(32), at: 3 });
    expect(conflict.state).toBe("reconcile_required");
    expect(transition(conflict, { type: "retry", at: 4 })).toBe(conflict);
    expect(transition(ok, { type: "lookupMissing", at: 3 }).state).toBe("reconcile_required");
    const hostConflict = transition(run(base(), [{ type: "hostSucceeded", hostRef: "fb:1" }]), { type: "hostSucceeded", hostRef: "fb:2", at: 3 });
    expect(hostConflict.state).toBe("reconcile_required");
    // duplicates with the same facts are no-ops
    expect(transition(ok, { type: "koinosSucceeded", txId: "0x1", postId: post, at: 3 }).state).toBe("submitting");
  });

  it("Koinos-only attempts succeed without a host", () => {
    const r = newCrossPostRecord({ idempotencyKey: "11".repeat(16), attemptId: "22".repeat(16), audience: 0, now: 1 });
    expect(r.hostStatus).toBe("not_required");
    expect(run(r, [{ type: "retry" }, { type: "koinosSucceeded", txId: "0x1", postId: post }]).state).toBe("succeeded");
    expect(run(r, [{ type: "hostSucceeded", hostRef: "x" }]).state).toBe("reconcile_required");
  });
});

describe("Reconciler", () => {
  const author = "1Author";
  it("resolves unknown outcomes through the chain before retrying and never republishes", async () => {
    const chain = { getPostByIdempotencyKey: async () => ({ value: { post_id: new Uint8Array(32).fill(0xaa) } }) };
    const reconciler = new Reconciler({ chain, now: () => 5 });
    const unknown = run(base(), [{ type: "retry" }, { type: "koinosUnknown" }]);
    let koinosCalls = 0;
    const result = await reconciler.retry(unknown, author, {
      publishKoinos: async () => {
        koinosCalls++;
        return { txId: "0x9", postId: post };
      },
      publishHost: async () => ({ hostRef: "fb:7" }),
    });
    expect(koinosCalls).toBe(0);
    expect(result.state).toBe("succeeded");
    expect(result.postId).toBe(post);
    expect(result.hostRef).toBe("fb:7");
  });

  it("falls back to the indexer and retries Koinos when nothing is found", async () => {
    const chain = { getPostByIdempotencyKey: async () => ({}) };
    let asked = 0;
    const indexer = {
      findByIdempotencyKey: async () => {
        asked++;
        return null;
      },
    };
    const reconciler = new Reconciler({ chain, indexer, now: () => 5 });
    const unknown = run(base(), [{ type: "retry" }, { type: "koinosUnknown" }]);
    const result = await reconciler.retry(unknown, author, {
      publishKoinos: async () => ({ txId: "0x9", postId: new Uint8Array(32).fill(0xcc) }),
      publishHost: async () => ({ hostRef: "fb:7" }),
    });
    expect(asked).toBe(1);
    expect(result.state).toBe("succeeded");
    expect(result.postId).toBe("cc".repeat(32));
  });

  it("resolves duplicate idempotency key rejections to the existing post", async () => {
    const chain = { getPostByIdempotencyKey: async () => ({ value: { post_id: new Uint8Array(32).fill(0xdd) } }) };
    const reconciler = new Reconciler({ chain, now: () => 5 });
    const partial = run(base(), [{ type: "retry" }, { type: "hostSucceeded", hostRef: "fb:1" }, { type: "koinosFailed", error: "x" }]);
    const result = await reconciler.retry(partial, author, {
      publishKoinos: async () => {
        throw new Error("transaction reverted: duplicate idempotency key");
      },
    });
    expect(result.state).toBe("succeeded");
    expect(result.postId).toBe("dd".repeat(32));
  });
});
