import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { ProviderInterface } from "@osp/sdk";
import { SponsorRefusal } from "./validate.js";

const day = (at: number) => new Date(at).toISOString().slice(0, 10);
function integer(value: string | number): number {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid RC amount");
  return Number(value);
}
interface Pending { id: string; account: string; day: string; maximum: number; cursor: number; }

/** Reserve maximum signed liability, not a simulation estimate. Never release an
 * uncertain broadcast. Only irreversible canonical receipts reduce a reservation.
 * SQLite transactions make the cap apply across concurrent service processes too. */
export class ManaBudget {
  private db: DatabaseSync;
  private reconciling?: Promise<void>;
  constructor(path: string, readonly scope: string, readonly dailyRc: string) {
    if (integer(dailyRc) < 1) throw new Error("Daily Mana allowance must be positive");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS mana_transactions (
        scope TEXT NOT NULL, id TEXT NOT NULL, account TEXT NOT NULL, day TEXT NOT NULL,
        maximum INTEGER NOT NULL, used INTEGER, cursor INTEGER NOT NULL, reverted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(scope,id));
      CREATE INDEX IF NOT EXISTS mana_account_day ON mana_transactions(scope,account,day);
      CREATE TABLE IF NOT EXISTS mana_aliases (
        scope TEXT NOT NULL, alias TEXT NOT NULL, account TEXT NOT NULL, owner TEXT NOT NULL, PRIMARY KEY(scope,alias));`);
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = fn(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  /** Only called after a confirmed reservation and a current-owner signature. */
  bindAlias(alias: string, account: string, owner: string): void {
    this.atomic(() => {
      const old = this.aliasAccount(alias);
      if (old && old !== account) throw new SponsorRefusal("invalid_transaction", "Private wallet already belongs to another account");
      // An alias cannot become another root's parent and create a second budget.
      if (this.aliasAccount(account)) throw new SponsorRefusal("invalid_transaction", "Private wallets cannot allocate another account's allowance");
      this.db.prepare("INSERT INTO mana_aliases VALUES (?,?,?,?) ON CONFLICT(scope,alias) DO UPDATE SET owner=excluded.owner").run(this.scope, alias, account, owner);
    });
  }
  aliasAccount(alias: string): string | undefined {
    return (this.db.prepare("SELECT account FROM mana_aliases WHERE scope=? AND alias=?").get(this.scope, alias) as { account: string } | undefined)?.account;
  }
  aliasOwner(alias: string): string | undefined {
    return (this.db.prepare("SELECT owner FROM mana_aliases WHERE scope=? AND alias=?").get(this.scope, alias) as { owner: string } | undefined)?.owner;
  }
  allowance(account: string, at = Date.now()) {
    const row = this.db.prepare(`SELECT COALESCE(SUM(COALESCE(used,maximum)),0) AS charged,
      COALESCE(SUM(CASE WHEN used IS NULL THEN maximum ELSE 0 END),0) AS reserved
      FROM mana_transactions WHERE scope=? AND account=? AND day=?`).get(this.scope, account, day(at)) as { charged: number; reserved: number };
    return { dailyRc: this.dailyRc, usedRc: String(row.charged - row.reserved), reservedRc: String(row.reserved),
      remainingRc: String(Math.max(0, integer(this.dailyRc) - row.charged)), resetsAt: new Date(Date.parse(day(at)) + 86400000).toISOString() };
  }
  reserve(id: string, account: string, maximum: string, startBlock: number, at = Date.now(), poolAvailable?: string): void {
    const amount = integer(maximum);
    if (!id || !account || !Number.isSafeInteger(startBlock) || startBlock < 1 || amount < 1) throw new Error("Invalid Mana reservation");
    this.atomic(() => {
      if (this.db.prepare("SELECT 1 FROM mana_transactions WHERE scope=? AND id=?").get(this.scope, id))
        throw new SponsorRefusal("invalid_transaction", "Transaction was already submitted; check its original outcome");
      if (poolAvailable !== undefined) {
        const pool = this.db.prepare("SELECT COALESCE(SUM(maximum),0) AS pending FROM mana_transactions WHERE scope=? AND used IS NULL").get(this.scope) as { pending: number };
        if (pool.pending + amount > integer(poolAvailable)) throw new SponsorRefusal("temporarily_unavailable", "Sponsor Mana pool is busy or depleted; your daily allowance has not been charged");
      }
      const allowance = this.allowance(account, at);
      if (amount > Number(allowance.remainingRc)) throw new SponsorRefusal("quota_exceeded", "Daily sponsored Mana allowance exhausted; it resets at 00:00 UTC", {
        ...allowance, retryAfterSec: Math.max(1, Math.ceil((Date.parse(allowance.resetsAt) - at) / 1000)),
      });
      this.db.prepare("INSERT INTO mana_transactions(scope,id,account,day,maximum,cursor) VALUES (?,?,?,?,?,?)")
        .run(this.scope, id, account, day(at), amount, startBlock - 1);
    });
  }
  /** Use exclusively for a local signing failure, before sendTransaction is called. */
  releaseUnsent(id: string): void {
    this.db.prepare("DELETE FROM mana_transactions WHERE scope=? AND id=? AND used IS NULL").run(this.scope, id);
  }
  pending(): Pending[] {
    return this.db.prepare("SELECT id,account,day,maximum,cursor FROM mana_transactions WHERE scope=? AND used IS NULL ORDER BY cursor LIMIT 1000")
      .all(this.scope) as unknown as Pending[];
  }
  /** Incrementally scan irreversible blocks. Missing receipts/partial RPC results
   * never advance the cursor. No mempool receipt is treated as final consumption. */
  reconcile(provider: ProviderInterface, payer: string): Promise<void> {
    if (this.reconciling) return this.reconciling;
    this.reconciling = this.scan(provider, payer).finally(() => { this.reconciling = undefined; });
    return this.reconciling;
  }
  private async scan(provider: ProviderInterface, payer: string): Promise<void> {
    const pending = this.pending();
    const byId = new Map(pending.map(p => [p.id, p]));
    if (!pending.length) return;
    const head = await provider.getHeadInfo(), lib = Number(head.last_irreversible_block);
    if (!Number.isSafeInteger(lib) || lib < 1 || lib > Number(head.head_topology.height)) throw new Error("Invalid irreversible height");
    const start = Math.min(...pending.map(p => p.cursor)) + 1, end = Math.min(lib, start + 127);
    for (let from = start; from <= end; from += 32) {
      const to = Math.min(end, from + 31);
      const blocks = await provider.getBlocks(from, to - from + 1, head.head_topology.id, { returnBlock: false, returnReceipt: true });
      const sorted = [...blocks].sort((a,b) => Number(a.block_height) - Number(b.block_height));
      if (sorted.length !== to - from + 1 || sorted.some((b,i) => Number(b.block_height) !== from + i || !b.block_id || !b.receipt || b.receipt.id !== b.block_id))
        throw new Error("Incomplete canonical receipt response; Mana holds retained");
      this.atomic(() => {
        for (const block of sorted) {
          for (const receipt of block.receipt.transaction_receipts ?? []) {
            const row = byId.get(receipt.id);
            if (!row || receipt.rpc_error) continue;
            const used = integer(receipt.rc_used);
            if (receipt.payer !== payer || used > row.maximum) throw new Error("Canonical receipt does not match sponsored liability");
            this.db.prepare("UPDATE mana_transactions SET used=?,reverted=? WHERE scope=? AND id=? AND used IS NULL")
              .run(used, receipt.reverted ? 1 : 0, this.scope, row.id);
          }
        }
        const placeholders = pending.map(() => "?").join(",");
        this.db.prepare(`UPDATE mana_transactions SET cursor=MAX(cursor,?) WHERE scope=? AND used IS NULL AND cursor<? AND id IN (${placeholders})`)
          .run(to, this.scope, to, ...pending.map(p => p.id));
      });
    }
  }
  outstanding() {
    const row = this.db.prepare("SELECT COUNT(*) AS transactions,COALESCE(SUM(maximum),0) AS reserved FROM mana_transactions WHERE scope=? AND used IS NULL").get(this.scope) as {transactions:number;reserved:number};
    return { transactions:row.transactions, reservedRc:String(row.reserved) };
  }
  aggregate(at = Date.now()) {
    const row = this.db.prepare(`SELECT COUNT(DISTINCT account) AS accounts, COUNT(*) AS transactions,
      COALESCE(SUM(used),0) AS used, COALESCE(SUM(CASE WHEN used IS NULL THEN maximum ELSE 0 END),0) AS reserved,
      COALESCE(SUM(reverted),0) AS reverted FROM mana_transactions WHERE scope=? AND day=?`)
      .get(this.scope, day(at)) as Record<string, number>;
    return { day: day(at), accounts: row.accounts, transactions: row.transactions, usedRc: String(row.used), reservedRc: String(row.reserved), reverted: row.reverted };
  }
  close(): void { this.db.close(); }
}
