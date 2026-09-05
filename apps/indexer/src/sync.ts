/**
 * Sync loop (spec section 11, ADR 0006).
 *
 *  - Polls the chain head and applies blocks in order, one SQLite transaction per block:
 *    event_log rows + projections + checkpoint (height, block id, previous id, state hash).
 *  - Never indexes above the head. Blocks at or below the last irreversible block (LIB) are final.
 *  - Reorg detection: a block's `header.previous` must equal the stored block id at height - 1
 *    (and the stored tip must still be on the canonical chain once caught up). On a mismatch the
 *    indexer rolls back to the last final checkpoint (deleting log rows and checkpoints above it),
 *    truncates the projections and replays the log: projections are a pure function of the log.
 */
import type { ChainBlock, ChainHead, ChainSource } from "./chain.js";
import type { CheckpointRow, IndexerDb } from "./db.js";
import { computeStateHash, toJsonValue, type EventView } from "./hash.js";
import { applyEvent, replayProjections, type LogEvent } from "./projections.js";

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

export const consoleLogger: Logger = {
  debug: () => {},
  info: (message, ...args) => console.log(`[indexer] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[indexer] ${message}`, ...args),
  error: (message, ...args) => console.error(`[indexer] ${message}`, ...args),
};

export class SyncError extends Error {
  override name = "SyncError";
}

export interface SyncOptions {
  db: IndexerDb;
  chain: ChainSource;
  /** First height to index (inclusive). */
  startHeight: number;
  /**
   * Chain id the node must report (the deployment manifest's `chainId`). Verified through
   * `chain.get_chain_id` before the first block is applied; a mismatch is a SyncError on every
   * step (nothing is ever indexed from the wrong network).
   */
  chainId?: string;
  batchSize?: number;
  pollIntervalMs?: number;
  /** When set, blocks below `head - reversibleWindow` are treated as final even if LIB lags. */
  reversibleWindow?: number;
  logger?: Logger;
}

export interface SyncResult {
  applied: number;
  caughtUp: boolean;
  /**
   * The node reported a head above our tip but served no applicable block (block store lagging
   * `chain.get_head_info`, failover to a node that is behind, a gap in the response): nothing
   * was applied and nothing can be until the next poll.
   */
  stalled?: boolean;
  rolledBack?: { from: number; to: number };
}

export interface SyncState {
  head?: ChainHead;
  /** Chain id reported by the node (once `chain.get_chain_id` answered). */
  rpcChainId?: string;
  /** Whether `rpcChainId` matches the configured chain id (undefined until compared). */
  chainIdMatch?: boolean;
  lastError?: string;
  lastSyncAt?: number;
  running: boolean;
  syncing: boolean;
  rollbacks: number;
  blocksApplied: number;
  /** Consecutive steps that stalled (see SyncResult.stalled); 0 once a block is applied or the tip is caught up. */
  stalledSteps: number;
}

/** Upper bound on consecutive steps within one poll tick (a safety net; the loop normally stops when a step makes no progress). */
export const MAX_STEPS_PER_TICK = 1000;

/** The JSON view of a block's events (what gets hashed and served by `/v1/events`). */
export function eventViews(block: ChainBlock): EventView[] {
  return block.events.map((event) => ({
    height: String(block.height),
    blockId: block.id,
    txIndex: event.txIndex,
    txId: event.txId,
    sequence: event.sequence,
    contract: event.contract,
    name: event.name,
    data: toJsonValue(event.data),
    impacted: [...event.impacted],
  }));
}

/**
 * Applies one block: log rows, projections and the checkpoint, atomically.
 * The block must be the direct successor of the last checkpoint (or the start height).
 */
export function applyBlock(db: IndexerDb, block: ChainBlock, startHeight: number): CheckpointRow {
  return db.transaction(() => {
    const last = db.lastCheckpoint();
    const expected = last ? last.height + 1 : startHeight;
    if (block.height !== expected) throw new SyncError(`cannot apply block ${block.height}: expected height ${expected}`);
    if (last && block.previous && last.block_id !== block.previous) {
      throw new SyncError(`block ${block.height} does not extend the stored block at ${last.height} (fork)`);
    }
    const views = eventViews(block);
    block.events.forEach((event, i) => {
      const view = views[i]!;
      db.run(
        `INSERT INTO event_log (height, tx_index, sequence, block_id, block_timestamp, tx_id, contract, name, data, data_json, impacted_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        block.height,
        event.txIndex,
        event.sequence,
        block.id,
        block.timestamp,
        event.txId,
        event.contract,
        event.name,
        event.raw,
        JSON.stringify(view.data),
        JSON.stringify(view.impacted),
      );
      const logEvent: LogEvent = {
        height: block.height,
        blockId: block.id,
        blockTimestamp: block.timestamp,
        txIndex: event.txIndex,
        sequence: event.sequence,
        txId: event.txId,
        contract: event.contract,
        name: event.name,
        data: event.data,
        impacted: [...event.impacted],
      };
      applyEvent(db, logEvent);
    });
    const stateHash = computeStateHash(last?.state_hash, views);
    const row: CheckpointRow = {
      height: block.height,
      block_id: block.id,
      previous_id: block.previous,
      timestamp: block.timestamp,
      state_hash: stateHash,
      event_count: block.events.length,
    };
    db.run(
      "INSERT INTO checkpoints (height, block_id, previous_id, timestamp, state_hash, event_count) VALUES (?, ?, ?, ?, ?, ?)",
      row.height,
      row.block_id,
      row.previous_id,
      row.timestamp,
      row.state_hash,
      row.event_count,
    );
    return row;
  });
}

/** Drops every block above `height` from the log and checkpoints, then rebuilds the projections. */
export function rollbackTo(db: IndexerDb, height: number): number {
  return db.transaction(() => {
    db.run("DELETE FROM event_log WHERE height > ?", height);
    db.run("DELETE FROM checkpoints WHERE height > ?", height);
    return replayProjections(db);
  });
}

export class Syncer {
  readonly db: IndexerDb;
  readonly chain: ChainSource;
  readonly startHeight: number;
  readonly chainId: string | undefined;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly reversibleWindow: number | undefined;
  readonly logger: Logger;
  readonly state: SyncState = { running: false, syncing: false, rollbacks: 0, blocksApplied: 0, stalledSteps: 0 };
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Serialises steps: every syncOnce() call is chained behind the previous one. */
  private queue: Promise<unknown> = Promise.resolve();
  private chainIdVerified = false;
  /** Head seen below our tip on the previous step (a shrink is acted on only when it persists). */
  private shrunkHead: ChainHead | undefined;

  constructor(options: SyncOptions) {
    this.db = options.db;
    this.chain = options.chain;
    this.startHeight = Math.max(1, options.startHeight);
    this.chainId = options.chainId;
    this.batchSize = Math.max(1, options.batchSize ?? 50);
    this.pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 2000);
    this.reversibleWindow = options.reversibleWindow;
    this.logger = options.logger ?? silentLogger;
  }

  /** Highest height considered final for `head`. */
  finalHeight(head: ChainHead): number {
    const lib = Number.isFinite(head.lastIrreversible) ? head.lastIrreversible : 0;
    if (this.reversibleWindow === undefined) return lib;
    return Math.max(lib, head.height - this.reversibleWindow);
  }

  /**
   * Compares the node's chain id with the configured one (once; retried on every step until it
   * succeeds). A mismatch means the manifest and the RPC belong to different networks: no block
   * is applied and `/v1/status` reports `chainIdMatch: false`.
   */
  private async verifyChainId(): Promise<void> {
    if (this.chainIdVerified) return;
    const rpcChainId = await this.chain.getChainId();
    this.state.rpcChainId = rpcChainId;
    if (this.chainId !== undefined) {
      this.state.chainIdMatch = rpcChainId === this.chainId;
      if (!this.state.chainIdMatch) {
        throw new SyncError(`chain id mismatch: the node reports ${rpcChainId} but the deployment manifest expects ${this.chainId}; refusing to index`);
      }
    }
    this.chainIdVerified = true;
  }

  /**
   * Rolls back to the last final checkpoint below `forkHeight` and replays the log.
   * Refuses (SyncError) when the canonical chain disagrees with us at the rollback target,
   * i.e. the fork is below the final height.
   */
  private async rollback(head: ChainHead, forkHeight: number): Promise<number> {
    const floor = this.startHeight - 1;
    const to = Math.max(Math.min(this.finalHeight(head), forkHeight - 1), floor);
    if (to >= forkHeight) throw new SyncError(`fork at height ${forkHeight} is not above the final height ${to}; refusing to roll back`);
    const ours = to > floor ? this.db.checkpointAt(to) : undefined;
    if (ours) {
      const canonical = (await this.chain.getBlocks(to, 1, head.id))[0];
      if (!canonical || canonical.id !== ours.block_id) {
        throw new SyncError(`fork below the final height ${to} (stored ${ours.block_id}, canonical ${canonical?.id ?? "unknown"}); refusing to roll back`);
      }
    }
    this.logger.warn(`fork detected at height ${forkHeight}; rolling back to ${to} and replaying the log`);
    const replayed = rollbackTo(this.db, to);
    this.state.rollbacks++;
    this.logger.info(`rollback complete: ${replayed} events replayed`);
    return to;
  }

  /**
   * One sync step: verifies the tip, fetches up to `batchSize` blocks and applies them.
   * Steps never overlap: concurrent callers are queued behind the in-flight step.
   */
  syncOnce(): Promise<SyncResult> {
    const run = this.queue.then(() => this.step());
    this.queue = run.catch(() => undefined);
    return run;
  }

  private finish(result: SyncResult): SyncResult {
    if (result.stalled) {
      this.state.stalledSteps++;
    } else {
      if (this.state.stalledSteps > 0) this.logger.info("node serves blocks again; resuming");
      this.state.stalledSteps = 0;
    }
    this.state.lastError = undefined;
    this.state.lastSyncAt = Date.now();
    return result;
  }

  private async step(): Promise<SyncResult> {
    this.state.syncing = true;
    try {
      await this.verifyChainId();
      const head = await this.chain.getHead();
      this.state.head = head;
      const last = this.db.lastCheckpoint();

      if (last && last.height >= head.height) return this.finish(await this.reconcileTip(head, last));
      this.shrunkHead = undefined;

      const next = last ? last.height + 1 : this.startHeight;
      const count = Math.min(this.batchSize, head.height - next + 1);
      const blocks = await this.chain.getBlocks(next, count, head.id);
      let applied = 0;
      let expected = next;
      for (const block of blocks) {
        if (block.height !== expected) break; // gap in the response: retry next poll
        const parent = this.db.checkpointAt(block.height - 1);
        if (parent && block.previous && parent.block_id !== block.previous) {
          const to = await this.rollback(head, block.height);
          return this.finish({ applied, caughtUp: false, rolledBack: { from: parent.height, to } });
        }
        applyBlock(this.db, block, this.startHeight);
        applied++;
        expected++;
        this.state.blocksApplied++;
        if (block.events.length > 0) this.logger.debug(`block ${block.height}: ${block.events.length} protocol events`);
      }
      const caughtUp = expected > head.height;
      const stalled = !caughtUp && applied === 0;
      if (stalled && this.state.stalledSteps === 0) {
        this.logger.warn(`node reports head ${head.height} but served no block at height ${next} (block store behind the head?); waiting for the next poll`);
      }
      return this.finish({ applied, caughtUp, ...(stalled && { stalled: true }) });
    } catch (error) {
      this.state.lastError = (error as Error).message;
      throw error;
    } finally {
      this.state.syncing = false;
    }
  }

  /**
   * Our tip is at or above the head. Verifies that our block at the head height is still the
   * canonical one (rolling back on a mismatch). When the head is *below* our tip and the block
   * there matches, the blocks above it are not on the chain the node serves: they are truncated
   * once the shrink persists over two consecutive steps (one poll of tolerance for a failover
   * node that is merely behind), so stale blocks never keep feeding feeds and state hashes.
   */
  private async reconcileTip(head: ChainHead, last: CheckpointRow): Promise<SyncResult> {
    const floor = this.startHeight - 1;
    const canonicalId = last.height === head.height ? head.id : (await this.chain.getBlocks(head.height, 1, head.id))[0]?.id;
    const ours = head.height > floor ? this.db.checkpointAt(head.height) : undefined;
    if (canonicalId && ours && ours.block_id !== canonicalId) {
      this.shrunkHead = undefined;
      const to = await this.rollback(head, head.height);
      return { applied: 0, caughtUp: false, rolledBack: { from: last.height, to } };
    }
    if (last.height === head.height) {
      this.shrunkHead = undefined;
      return { applied: 0, caughtUp: true };
    }
    // head.height < last.height and (when known) our block at the head height is canonical.
    if (!this.shrunkHead) {
      this.shrunkHead = head;
      this.logger.warn(`head ${head.height} is below the indexed tip ${last.height}; truncating if it persists on the next poll`);
      return { applied: 0, caughtUp: true };
    }
    const to = Math.max(head.height, floor);
    this.logger.warn(`head ${head.height} stayed below the indexed tip ${last.height}; dropping blocks above ${to} and replaying the log`);
    const replayed = rollbackTo(this.db, to);
    this.state.rollbacks++;
    this.shrunkHead = undefined;
    this.logger.info(`rollback complete: ${replayed} events replayed`);
    return { applied: 0, caughtUp: true, rolledBack: { from: last.height, to } };
  }

  /**
   * Syncs until caught up with the head (tests, `--once`). Rollbacks are followed automatically;
   * a stalled step ends the run with `caughtUp: false, stalled: true` instead of spinning.
   */
  async syncToHead(maxRounds = 10_000): Promise<SyncResult> {
    let result: SyncResult = { applied: 0, caughtUp: false };
    for (let i = 0; i < maxRounds; i++) {
      const step = await this.syncOnce();
      const rolledBack = step.rolledBack ?? result.rolledBack;
      result = { applied: result.applied + step.applied, caughtUp: step.caughtUp, ...(step.stalled && { stalled: true }), ...(rolledBack && { rolledBack }) };
      if (step.caughtUp || step.stalled) return result;
    }
    throw new SyncError("syncToHead did not catch up");
  }

  /**
   * Starts the poll loop. Within one tick, steps repeat only while they make progress (blocks
   * applied or a rollback); a caught-up, stalled or failed step waits `pollIntervalMs`.
   */
  start(): void {
    if (this.state.running) return;
    this.state.running = true;
    const tick = async () => {
      if (!this.state.running) return;
      try {
        let result = await this.syncOnce();
        let steps = 1;
        while (this.state.running && !result.caughtUp && !result.stalled && steps < MAX_STEPS_PER_TICK) {
          result = await this.syncOnce();
          steps++;
        }
      } catch (error) {
        this.logger.warn(`sync error: ${(error as Error).message}`);
      }
      if (this.state.running) this.timer = setTimeout(tick, this.pollIntervalMs);
    };
    this.timer = setTimeout(tick, 0);
  }

  /** Stops the poll loop and waits for the in-flight step. */
  async stop(): Promise<void> {
    this.state.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.queue;
  }
}
