import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QuotaStore, utcDay } from "./quota.js";

const limits = { dailyOps: 5, burstOps: 3, burstWindowSec: 60 };
const noon = Date.UTC(2026, 8, 5, 12, 0, 0);
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function memoryStore(now: () => number = () => noon): QuotaStore {
  const store = new QuotaStore({ path: ":memory:", limits, now });
  cleanups.push(() => store.close());
  return store;
}

describe("QuotaStore", () => {
  it("counts operations per user and UTC day", () => {
    const store = memoryStore();
    expect(store.check("alice", 2)).toMatchObject({ ok: true, remaining: { daily: 5, burst: 3 } });
    store.recordAccepted("alice", { ops: 2, rcUsed: "100" });
    store.recordAccepted("alice", { ops: 2, rcUsed: "50" }, noon + 61_000);
    expect(store.dailyOps("alice")).toBe(4);
    expect(store.dailyOps("bob")).toBe(0);
    const refused = store.check("alice", 2, noon + 62_000);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.category).toBe("quota_exceeded");
      expect(refused.message).toMatch(/daily/);
      expect(refused.retryAfterSec).toBe(Math.ceil((Date.UTC(2026, 8, 6) - (noon + 62_000)) / 1000));
      expect(refused.remaining.daily).toBe(1);
    }
    expect(store.check("alice", 1, noon + 62_000).ok).toBe(true);
    // the next UTC day starts fresh
    const tomorrow = Date.UTC(2026, 8, 6, 0, 0, 1);
    expect(store.dailyOps("alice", tomorrow)).toBe(0);
    expect(store.check("alice", 3, tomorrow).ok).toBe(true);
    // 5 at once would still exceed the burst allowance of 3
    expect(store.check("alice", 5, tomorrow).ok).toBe(false);
  });

  it("enforces the in-memory burst window", () => {
    const store = memoryStore();
    store.recordAccepted("alice", { ops: 2 }, noon);
    expect(store.burstOps("alice", noon + 1_000)).toBe(2);
    expect(store.check("alice", 1, noon + 1_000).ok).toBe(true);
    const refused = store.check("alice", 2, noon + 1_000);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.message).toMatch(/burst/);
      expect(refused.retryAfterSec).toBe(59);
    }
    expect(store.burstOps("alice", noon + 60_001)).toBe(0);
    expect(store.check("alice", 3, noon + 60_001).ok).toBe(true);
  });

  it("reserves synchronously, then commits or releases", () => {
    const store = memoryStore();
    const first = store.reserve("alice", 2, noon);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.remaining).toEqual({ daily: 3, burst: 1 });
    // charged immediately, before anything is broadcast
    expect(store.dailyOps("alice")).toBe(2);
    expect(store.burstOps("alice")).toBe(2);
    expect(store.check("alice", 2).ok).toBe(false);
    const second = store.reserve("alice", 2, noon);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.message).toMatch(/burst/);
    // nothing accepted yet
    expect(store.utilization(noon).today.accepted).toBe(0);
    // nothing was broadcast: the operations go back, the row disappears
    first.release();
    expect(store.dailyOps("alice")).toBe(0);
    expect(store.burstOps("alice")).toBe(0);
    expect(store.utilization(noon).today.users).toBe(0);
    // release/commit are idempotent and exclusive
    first.release();
    first.commit({ rcUsed: "5" });
    expect(store.dailyOps("alice")).toBe(0);
    expect(store.utilization(noon).today.accepted).toBe(0);
    // a committed reservation carries the receipt data
    const third = store.reserve("alice", 3, noon + 1_000);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    third.commit({ rcUsed: "42", reverted: true });
    third.release();
    expect(store.dailyOps("alice")).toBe(3);
    expect(store.burstOps("alice", noon + 1_000)).toBe(3);
    expect(store.utilization(noon).today).toMatchObject({ accepted: 1, acceptedOps: 3, reverted: 1, rcUsed: "42", users: 1 });
    expect(store.check("alice", 3, noon + 2_000).ok).toBe(false);
    // releasing one reservation leaves the others untouched
    const a = store.reserve("bob", 1, noon);
    const b = store.reserve("bob", 1, noon + 1);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok) a.release();
    expect(store.dailyOps("bob")).toBe(1);
    expect(store.burstOps("bob", noon + 2)).toBe(1);
    if (b.ok) b.commit();
    expect(store.utilization(noon).today.users).toBe(2);
    // the daily limit is reserved too
    for (let i = 0; i < 4; i += 1) {
      const r = store.reserve("carol", 1, noon + i * 30_000);
      expect(r.ok).toBe(true);
    }
    const fifth = store.reserve("carol", 2, noon + 120_000);
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) expect(fifth.message).toMatch(/daily/);
  });

  it("aggregates utilization by day and category without per-user rows", () => {
    const store = memoryStore();
    store.recordAccepted("alice", { ops: 1, rcUsed: "10" }, noon);
    store.recordAccepted("bob", { ops: 3, rcUsed: "20", reverted: true }, noon);
    store.recordRefusal("quota_exceeded", noon);
    store.recordRefusal("quota_exceeded", noon);
    store.recordRefusal("invalid_signature", noon);
    store.recordAccepted("alice", { ops: 1, rcUsed: "5" }, noon - 86_400_000);
    const report = store.utilization(noon);
    expect(report.generatedAt).toBe(new Date(noon).toISOString());
    expect(report.limits).toEqual(limits);
    expect(report.today).toEqual({
      day: "2026-09-05",
      accepted: 2,
      acceptedOps: 4,
      reverted: 1,
      rcUsed: "30",
      refused: { quota_exceeded: 2, method_not_allowed: 0, too_large: 0, chain_mismatch: 0, invalid_signature: 1, invalid_transaction: 0, temporarily_unavailable: 0 },
      refusedTotal: 3,
      users: 2,
    });
    expect(report.yesterday.day).toBe("2026-09-04");
    expect(report.yesterday.accepted).toBe(1);
    expect(report.yesterday.rcUsed).toBe("5");
    expect(JSON.stringify(report)).not.toContain("alice");
    expect(utcDay(noon)).toBe("2026-09-05");
  });

  it("persists daily usage across restarts (burst state is per process)", () => {
    const dir = mkdtempSync(join(tmpdir(), "osp-sponsor-quota-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "nested", "sponsor.sqlite");
    const first = new QuotaStore({ path, limits, now: () => noon });
    first.recordAccepted("alice", { ops: 4, rcUsed: "7" });
    first.recordRefusal("too_large");
    first.close();
    const second = new QuotaStore({ path, limits, now: () => noon + 1_000 });
    cleanups.push(() => second.close());
    expect(second.dailyOps("alice")).toBe(4);
    expect(second.check("alice", 2).ok).toBe(false);
    expect(second.burstOps("alice")).toBe(0);
    expect(second.utilization().today.refused.too_large).toBe(1);
  });
});
