import { createHash } from "node:crypto";
import type { IndexerDb } from "./db.js";

/** A shared, recipient-free wakeup signal. It carries no messages or delivery proof. */
export class PrivateUpdates {
  private readonly waiters = new Set<(cursor?: string) => void>();
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(private readonly db: IndexerDb) {}

  cursor(): string {
    const tip = this.db.lastCheckpoint();
    // Include block identity, not just height/sequence: same-height replacements
    // and rollbacks must wake clients too. Finality can advance without a packet.
    return createHash("sha256").update(tip ? `${tip.height}:${tip.block_id}` : "empty").digest("hex");
  }

  async wait(after: string | undefined, signal: AbortSignal, timeoutMs = 20_000): Promise<{ cursor: string; retryAfterMs?: number }> {
    const current = this.cursor();
    if (!after || after !== current || this.closed || signal.aborted) return { cursor: current };
    // Bounded resource use; clients retain ordinary polling if the watch is full.
    if (this.waiters.size >= 256) return { cursor: current, retryAfterMs: 8000 };
    await new Promise<void>(resolve => {
      let timeout: ReturnType<typeof setTimeout>;
      const finish = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", finish);
        this.waiters.delete(check);
        if (!this.waiters.size) { clearInterval(this.timer); this.timer = undefined; }
        resolve();
      };
      const check = (cursor = this.cursor()) => { if (this.closed || cursor !== after) finish(); };
      this.waiters.add(check);
      signal.addEventListener("abort", finish, { once: true });
      timeout = setTimeout(finish, timeoutMs);
      // One timer for the whole API, never one blockchain poll per browser.
      this.timer ??= setInterval(() => { const cursor = this.cursor(); for (const wake of this.waiters) wake(cursor); }, 500);
      this.timer.unref();
      check();
    });
    return { cursor: this.cursor() };
  }

  close(): void {
    this.closed = true;
    for (const wake of this.waiters) wake();
    clearInterval(this.timer);
  }
}
