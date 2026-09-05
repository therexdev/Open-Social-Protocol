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

export interface QuotaRemaining {
  daily: number;
  burst: number;
}

export interface QuotaRefusal {
  ok: false;
  category: "quota_exceeded";
  message: string;
  retryAfterSec: number;
  remaining: QuotaRemaining;
}

export type QuotaDecision = { ok: true; remaining: QuotaRemaining } | QuotaRefusal;

/** Outcome of a broadcast, recorded against a reservation. */
export interface BroadcastUsage {
  /** Decimal RC used (from the receipt); "0" when unknown. */
  rcUsed?: string | undefined;
  reverted?: boolean | undefined;
}

export interface AcceptedUsage extends BroadcastUsage {
  ops: number;
}

/**
 * Operations already charged to a payee, handed out by `reserve` before anything is
 * broadcast. Exactly one of `commit` / `release` should follow; both are idempotent.
 */
export interface QuotaReservation {
  ok: true;
  user: string;
  ops: number;
  /** Allowance left after this reservation. */
  remaining: QuotaRemaining;
  /** The transaction was broadcast (reverted or not, the sponsor paid): add its receipt data. */
  commit(usage?: BroadcastUsage): void;
  /** Nothing was broadcast (chain rejection, transport failure): give the operations back. */
  release(): void;
}

export type ReserveDecision = QuotaReservation | QuotaRefusal;

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

  /** Runs `fn` inside one SQLite transaction (rolled back when it throws). */
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Charges `ops` to the user's day row and burst window (no limit check). */
  private hold(user: string, ops: number, at: number): { at: number; ops: number } {
    const day = utcDay(at);
    this.db
      .prepare(
        `INSERT INTO usage (user, day, ops, txs, reverted, rc_used, updated_at) VALUES (?, ?, ?, 0, 0, 0, ?)
         ON CONFLICT(user, day) DO UPDATE SET ops = ops + excluded.ops, updated_at = excluded.updated_at`,
      )
      .run(user, day, ops, at);
    const entry = { at, ops };
    const window = this.bursts.get(user) ?? [];
    window.push(entry);
    this.bursts.set(user, window);
    return entry;
  }

  /** Undoes `hold` (caller opens the transaction): a row that never carried a transaction is dropped. */
  private unhold(user: string, entry: { at: number; ops: number }): void {
    const day = utcDay(entry.at);
    this.db.prepare("UPDATE usage SET ops = MAX(0, ops - ?), updated_at = ? WHERE user = ? AND day = ?").run(entry.ops, entry.at, user, day);
    this.db.prepare("DELETE FROM usage WHERE user = ? AND day = ? AND ops = 0 AND txs = 0").run(user, day);
    const window = this.bursts.get(user);
    if (!window) return;
    const index = window.indexOf(entry);
    if (index >= 0) window.splice(index, 1);
    if (window.length === 0) this.bursts.delete(user);
  }

  /** Adds a broadcast transaction's receipt data to a row whose ops were already held (caller opens the transaction). */
  private settle(user: string, ops: number, usage: BroadcastUsage, at: number): void {
    const day = utcDay(at);
    const rc = Number.isSafeInteger(Number(usage.rcUsed ?? "0")) ? Number(usage.rcUsed ?? "0") : 0;
    const reverted = usage.reverted ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO usage (user, day, ops, txs, reverted, rc_used, updated_at) VALUES (?, ?, 0, 1, ?, ?, ?)
         ON CONFLICT(user, day) DO UPDATE SET txs = txs + 1, reverted = reverted + excluded.reverted,
           rc_used = rc_used + excluded.rc_used, updated_at = excluded.updated_at`,
      )
      .run(user, day, reverted, rc, at);
    this.bump(day, "accepted", 1);
    this.bump(day, "accepted_ops", ops);
    if (reverted) this.bump(day, "reverted", 1);
    if (rc > 0) this.bump(day, "rc_used", rc);
  }

  /**
   * Checks the allowances and, when they fit, charges `ops` to the user immediately, in one
   * synchronous critical section: requests that arrive while a broadcast is still in flight
   * see the reserved operations and cannot slip past the daily or burst quota. The caller then
   * `commit`s the reservation (the transaction was broadcast, paid or reverted) or `release`s
   * it (nothing was broadcast).
   */
  reserve(user: string, ops: number, at: number = this.now()): ReserveDecision {
    const held = this.transaction((): { decision: QuotaDecision; entry?: { at: number; ops: number } } => {
      const decision = this.check(user, ops, at);
      return decision.ok ? { decision, entry: this.hold(user, ops, at) } : { decision };
    });
    if (!held.decision.ok) return held.decision;
    // `hold` pushed this very object; `release` looks it up by identity after window pruning.
    const entry = held.entry ?? { at, ops };
    const remaining = { daily: Math.max(0, held.decision.remaining.daily - ops), burst: Math.max(0, held.decision.remaining.burst - ops) };
    let settled = false;
    return {
      ok: true,
      user,
      ops,
      remaining,
      commit: (usage: BroadcastUsage = {}) => {
        if (settled) return;
        settled = true;
        this.transaction(() => this.settle(user, ops, usage, at));
      },
      release: () => {
        if (settled) return;
        settled = true;
        this.transaction(() => this.unhold(user, entry));
      },
    };
  }

  /** Records a broadcast transaction unconditionally (reverted ones count too: the sponsor paid for them). */
  recordAccepted(user: string, usage: AcceptedUsage, at: number = this.now()): void {
    this.transaction(() => {
      this.hold(user, usage.ops, at);
      this.settle(user, usage.ops, usage, at);
    });
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
