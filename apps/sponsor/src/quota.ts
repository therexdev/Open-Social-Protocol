/**
 * Per-user quotas and aggregate utilization (spec section 10, items 2 and 4).
 *
 * Daily usage lives in SQLite (`node:sqlite`) keyed by `(user, utc day)` so it survives
 * restarts; the burst window is in memory. Utilization is aggregated by day and category
 * and never exposes per-user rows.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SPONSOR_ERROR_CATEGORIES, type SponsorErrorCategory } from "@osp/sdk";

export interface QuotaLimits {
  dailyOps: number;
  burstOps: number;
  burstWindowSec: number;
}

export type QuotaDecision =
  | { ok: true; remaining: { daily: number; burst: number } }
  | { ok: false; category: "quota_exceeded"; message: string; retryAfterSec: number; remaining: { daily: number; burst: number } };

export interface AcceptedUsage {
  ops: number;
  /** Decimal RC used (from the receipt); "0" when unknown. */
  rcUsed?: string;
  reverted?: boolean;
}

export interface DayUtilization {
  day: string;
  /** Transactions broadcast (reverted ones included). */
  accepted: number;
  acceptedOps: number;
  reverted: number;
  /** Decimal RC consumed by accepted transactions. */
  rcUsed: string;
  refused: Record<SponsorErrorCategory, number>;
  refusedTotal: number;
  /** Distinct payees served (an aggregate, not a list). */
  users: number;
}

export interface UtilizationReport {
  generatedAt: string;
  limits: QuotaLimits;
  today: DayUtilization;
  yesterday: DayUtilization;
}

export interface QuotaStoreOptions {
  /** SQLite path; `:memory:` for tests. */
  path: string;
  limits: QuotaLimits;
  now?: () => number;
}

/** UTC calendar day (`YYYY-MM-DD`) of a millisecond timestamp. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function emptyRefusals(): Record<SponsorErrorCategory, number> {
  const out = {} as Record<SponsorErrorCategory, number>;
  for (const category of SPONSOR_ERROR_CATEGORIES) out[category] = 0;
  return out;
}

export class QuotaStore {
  readonly limits: QuotaLimits;
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly bursts = new Map<string, Array<{ at: number; ops: number }>>();
  private closed = false;

  constructor(options: QuotaStoreOptions) {
    this.limits = options.limits;
    this.now = options.now ?? Date.now;
    if (options.path !== ":memory:") mkdirSync(dirname(options.path), { recursive: true });
    this.db = new DatabaseSync(options.path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS usage (
        user TEXT NOT NULL,
        day TEXT NOT NULL,
        ops INTEGER NOT NULL DEFAULT 0,
        txs INTEGER NOT NULL DEFAULT 0,
        reverted INTEGER NOT NULL DEFAULT 0,
        rc_used INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user, day)
      );
      CREATE TABLE IF NOT EXISTS counters (
        day TEXT NOT NULL,
        key TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, key)
      );
    `);
  }

  /** Ops already counted for `user` on the UTC day of `at`. */
  dailyOps(user: string, at: number = this.now()): number {
    const row = this.db.prepare("SELECT ops FROM usage WHERE user = ? AND day = ?").get(user, utcDay(at)) as { ops: number } | undefined;
    return row?.ops ?? 0;
  }

  private burstWindow(user: string, at: number): Array<{ at: number; ops: number }> {
    const cutoff = at - this.limits.burstWindowSec * 1000;
    const kept = (this.bursts.get(user) ?? []).filter((entry) => entry.at > cutoff);
    if (kept.length === 0) this.bursts.delete(user);
    else this.bursts.set(user, kept);
    return kept;
  }

  /** Ops accepted for `user` inside the current burst window. */
  burstOps(user: string, at: number = this.now()): number {
    return this.burstWindow(user, at).reduce((sum, entry) => sum + entry.ops, 0);
  }

  /** Decides whether `ops` more operations fit the user's daily and burst allowances. */
  check(user: string, ops: number, at: number = this.now()): QuotaDecision {
    const daily = this.dailyOps(user, at);
    const window = this.burstWindow(user, at);
    const burst = window.reduce((sum, entry) => sum + entry.ops, 0);
    const remaining = { daily: Math.max(0, this.limits.dailyOps - daily), burst: Math.max(0, this.limits.burstOps - burst) };
    if (daily + ops > this.limits.dailyOps) {
      const nextDay = Date.UTC(new Date(at).getUTCFullYear(), new Date(at).getUTCMonth(), new Date(at).getUTCDate() + 1);
      return {
        ok: false,
        category: "quota_exceeded",
        message: `daily quota of ${this.limits.dailyOps} operations reached (${daily} used, ${ops} requested)`,
        retryAfterSec: Math.max(1, Math.ceil((nextDay - at) / 1000)),
        remaining,
      };
    }
    if (burst + ops > this.limits.burstOps) {
      const oldest = window[0]?.at ?? at;
      return {
        ok: false,
        category: "quota_exceeded",
        message: `burst quota of ${this.limits.burstOps} operations per ${this.limits.burstWindowSec}s reached`,
        retryAfterSec: Math.max(1, Math.ceil((oldest + this.limits.burstWindowSec * 1000 - at) / 1000)),
        remaining,
      };
    }
    return { ok: true, remaining };
  }

  /** Records a broadcast transaction (reverted ones count too: the sponsor paid for them). */
  recordAccepted(user: string, usage: AcceptedUsage, at: number = this.now()): void {
    const day = utcDay(at);
    const rc = Number.isSafeInteger(Number(usage.rcUsed ?? "0")) ? Number(usage.rcUsed ?? "0") : 0;
    const reverted = usage.reverted ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO usage (user, day, ops, txs, reverted, rc_used, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(user, day) DO UPDATE SET ops = ops + excluded.ops, txs = txs + 1, reverted = reverted + excluded.reverted,
           rc_used = rc_used + excluded.rc_used, updated_at = excluded.updated_at`,
      )
      .run(user, day, usage.ops, reverted, rc, at);
    this.bump(day, "accepted", 1);
    this.bump(day, "accepted_ops", usage.ops);
    if (reverted) this.bump(day, "reverted", 1);
    if (rc > 0) this.bump(day, "rc_used", rc);
    const window = this.bursts.get(user) ?? [];
    window.push({ at, ops: usage.ops });
    this.bursts.set(user, window);
  }

  /** Records a refusal by category (aggregate only). */
  recordRefusal(category: SponsorErrorCategory, at: number = this.now()): void {
    this.bump(utcDay(at), `refused:${category}`, 1);
  }

  private bump(day: string, key: string, by: number): void {
    this.db
      .prepare("INSERT INTO counters (day, key, value) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET value = value + excluded.value")
      .run(day, key, by);
  }

  /** Aggregates for one UTC day. */
  day(day: string): DayUtilization {
    const rows = this.db.prepare("SELECT key, value FROM counters WHERE day = ?").all(day) as Array<{ key: string; value: number }>;
    const counters = new Map(rows.map((r) => [r.key, r.value]));
    const refused = emptyRefusals();
    let refusedTotal = 0;
    for (const category of SPONSOR_ERROR_CATEGORIES) {
      const n = counters.get(`refused:${category}`) ?? 0;
      refused[category] = n;
      refusedTotal += n;
    }
    const users = this.db.prepare("SELECT COUNT(*) AS n FROM usage WHERE day = ?").get(day) as { n: number };
    return {
      day,
      accepted: counters.get("accepted") ?? 0,
      acceptedOps: counters.get("accepted_ops") ?? 0,
      reverted: counters.get("reverted") ?? 0,
      rcUsed: String(counters.get("rc_used") ?? 0),
      refused,
      refusedTotal,
      users: users.n,
    };
  }

  /** `GET /v1/utilization` payload: today and yesterday, no per-user data. */
  utilization(at: number = this.now()): UtilizationReport {
    return {
      generatedAt: new Date(at).toISOString(),
      limits: { ...this.limits },
      today: this.day(utcDay(at)),
      yesterday: this.day(utcDay(at - 86_400_000)),
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
