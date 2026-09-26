import { System, Storage } from "@koinos/sdk-as";
import { token } from "./proto/token";
import { Util } from "./common/util";

export const FULL: u64 = 144000;
const SIZE: u32 = 262144; // 2^18 slots; larger than the complete recovery horizon.
const MASK: u64 = 262143;

export function height(): u64 {
  const h = System.getHeadInfo().head_topology;
  System.require(h != null, "block height unavailable");
  // count <= 1,000,000; deadline sums and capacity products fit in u64.
  System.require(h!.height < (u64(1) << 40), "block height exceeds resource bounds");
  return h!.height;
}

// Sparse fixed-depth segment trees of absolute maturity deadlines, addressed by
// deadline modulo 2^18. There cannot be two live epochs in one slot. Expiration
// and least-charge-first consumption each visit O(18) nodes, regardless of balance
// or history. Clearing a subtree raises its generation floor instead of walking
// its leaves. Stale descendants are never read as live state; keys are reused.
export class Recharge {
  nodes: Storage.Map<Uint8Array, token.recharge_node>;
  states: Storage.Map<Uint8Array, token.recharge_state>;
  cache: Map<u32, token.recharge_node> = new Map<u32, token.recharge_node>();
  dirty: Set<u32> = new Set<u32>();
  state: token.recharge_state = new token.recharge_state();
  account: Uint8Array;
  value: token.account_state;
  now: u64;
  reads: u32 = 0;
  exhausted: u64 = 0;
  partialCount: u64 = 0;
  partialDeadline: u64 = 0;

  constructor(id: Uint8Array, account: Uint8Array, a: token.account_state, c: token.config, block: u64) {
    this.account = account;
    this.value = a;
    this.now = block;
    this.nodes = new Storage.Map<Uint8Array, token.recharge_node>(id, 7, token.recharge_node.decode, token.recharge_node.encode, null);
    this.states = new Storage.Map<Uint8Array, token.recharge_state>(id, 6, token.recharge_state.decode, token.recharge_state.encode, null);
    const stored = this.states.get(account);
    this.state = stored == null ? new token.recharge_state(0, 0, c.activation_block, 1) : stored!;
    if (stored == null) {
      System.require(a.balance <= 1000000, "invalid legacy balance");
      System.require(a.updated_at <= c.activation_time, "legacy state exceeds migration cutoff");
      const elapsed = min<u64>(c.activation_time - a.updated_at, 86400000);
      const paidCap = a.balance * 1000;
      const free = min<u64>(100000, a.free_credits + (100000 * elapsed) / 86400000) * 144;
      const paid = min<u64>(paidCap, a.token_credits + (paidCap * elapsed) / 86400000) * 144;
      this.seed(0, 100, free, c.activation_block);
      this.seed(1, a.balance, paid, c.activation_block);
    }
    System.require(block >= this.state.block, "resource clock moved backwards");
    System.require(this.state.revision < u64.MAX_VALUE, "resource revision exhausted");
    this.state.revision++;
    for (let pool: u32 = 0; pool < 2; pool++) {
      let matured: u64 = 0;
      if (block - this.state.block >= FULL) {
        const root = this.get(pool, 1, 0);
        matured = root.count;
        if (root.count > 0) this.clear(pool, 1, root);
      } else if (block > this.state.block) {
        const first = u32(this.state.block & MASK), last = u32(block & MASK);
        if (first < last) matured = this.expire(pool, 1, 0, SIZE - 1, first + 1, last, 0);
        else {
          if (first < SIZE - 1) matured += this.expire(pool, 1, 0, SIZE - 1, first + 1, SIZE - 1, 0);
          matured += this.expire(pool, 1, 0, SIZE - 1, 0, last, 0);
        }
      }
      if (pool == 0) this.state.free_ready += matured;
      else this.state.paid_ready += matured;
    }
    this.state.block = block;
  }
  key(pool: u32, index: u32): u32 { return pool * (SIZE * 2) + index; }
  get(pool: u32, index: u32, floor: u64): token.recharge_node {
    const k = this.key(pool, index);
    let n: token.recharge_node | null = null;
    if (this.cache.has(k)) n = this.cache.get(k);
    else { n = this.nodes.get(Util.concat([this.account, Util.u32be(k)])); this.reads++; }
    if (n == null || n!.revision < floor) n = new token.recharge_node(0, 0, floor, floor);
    this.cache.set(k, n!);
    return n!;
  }
  put(pool: u32, index: u32, n: token.recharge_node): void {
    n.revision = this.state.revision;
    const k = this.key(pool, index);
    this.cache.set(k, n);
    this.dirty.add(k);
  }
  clear(pool: u32, index: u32, n: token.recharge_node): void {
    System.require(this.state.revision < u64.MAX_VALUE, "resource revision exhausted");
    this.state.revision++;
    n.count = 0; n.deadlines = 0; n.floor = this.state.revision;
    this.put(pool, index, n);
  }
  join(pool: u32, index: u32, n: token.recharge_node): void {
    const left = this.get(pool, index * 2, n.floor), right = this.get(pool, index * 2 + 1, n.floor);
    n.count = left.count + right.count;
    n.deadlines = left.deadlines + right.deadlines;
    this.put(pool, index, n);
  }
  insert(pool: u32, count: u64, deadline: u64, index: u32 = 1, lo: u32 = 0, hi: u32 = SIZE - 1, floor: u64 = 0): void {
    if (count == 0) return;
    const n = this.get(pool, index, floor);
    if (lo == hi) {
      System.require(n.count == 0 || n.deadlines / n.count == deadline, "overlapping recharge epochs");
      n.count += count; n.deadlines += count * deadline;
      this.put(pool, index, n);
      return;
    }
    const mid = (lo + hi) / 2;
    if (u32(deadline & MASK) <= mid) this.insert(pool, count, deadline, index * 2, lo, mid, n.floor);
    else this.insert(pool, count, deadline, index * 2 + 1, mid + 1, hi, n.floor);
    this.join(pool, index, n);
  }
  seed(pool: u32, count: u64, ticks: u64, block: u64): void {
    System.require(ticks <= count * FULL, "invalid migration credits");
    const ready = ticks / FULL, partial = ticks % FULL;
    if (pool == 0) this.state.free_ready = ready;
    else this.state.paid_ready = ready;
    this.insert(pool, count - ready - (partial > 0 ? 1 : 0), block + FULL);
    if (partial > 0) this.insert(pool, 1, block + FULL - partial);
  }
  expire(pool: u32, index: u32, lo: u32, hi: u32, start: u32, end: u32, floor: u64): u64 {
    if (hi < start || lo > end) return 0;
    const n = this.get(pool, index, floor);
    if (n.count == 0) return 0;
    if (start <= lo && hi <= end) {
      const count = n.count;
      this.clear(pool, index, n);
      return count;
    }
    const mid = (lo + hi) / 2;
    const count = this.expire(pool, index * 2, lo, mid, start, end, n.floor)
      + this.expire(pool, index * 2 + 1, mid + 1, hi, start, end, n.floor);
    this.join(pool, index, n);
    return count;
  }
  capacity(pool: u32): u64 {
    const n = this.get(pool, 1, 0);
    const ready = pool == 0 ? this.state.free_ready : this.state.paid_ready;
    return ready * FULL + n.count * (this.now + FULL) - n.deadlines;
  }
  // Returns unspent cost. New depleted cohorts are inserted after traversal, so
  // credits cannot be consumed twice and no additional recharge streams appear.
  drain(pool: u32, index: u32, lo: u32, hi: u32, start: u32, end: u32, cost: u64, floor: u64): u64 {
    if (cost == 0 || hi < start || lo > end) return cost;
    const n = this.get(pool, index, floor);
    const capacity = n.count * (this.now + FULL) - n.deadlines;
    if (capacity == 0) return cost;
    if (start <= lo && hi <= end && capacity <= cost) {
      this.exhausted += n.count;
      this.clear(pool, index, n);
      return cost - capacity;
    }
    if (lo == hi) {
      const deadline = n.deadlines / n.count, charge = this.now + FULL - deadline;
      const count = cost / charge, rest = cost % charge;
      this.exhausted += count;
      n.count -= count;
      if (rest > 0) { n.count--; this.partialCount = 1; this.partialDeadline = deadline + rest; }
      n.deadlines = n.count * deadline;
      this.put(pool, index, n);
      return 0;
    }
    const mid = (lo + hi) / 2;
    cost = this.drain(pool, index * 2 + 1, mid + 1, hi, start, end, cost, n.floor);
    cost = this.drain(pool, index * 2, lo, mid, start, end, cost, n.floor);
    this.join(pool, index, n);
    return cost;
  }
  spend(pool: u32, cost: u64): void {
    System.require(cost <= this.capacity(pool), "usage allowance exhausted; wait for regeneration");
    if (cost == 0) return;
    this.exhausted = 0; this.partialCount = 0;
    const first = u32(this.now & MASK), last = u32((this.now + FULL) & MASK);
    if (first < last) cost = this.drain(pool, 1, 0, SIZE - 1, first + 1, last, cost, 0);
    else {
      cost = this.drain(pool, 1, 0, SIZE - 1, 0, last, cost, 0);
      if (first < SIZE - 1) cost = this.drain(pool, 1, 0, SIZE - 1, first + 1, SIZE - 1, cost, 0);
    }
    const count = cost / FULL, rest = cost % FULL;
    const usedReady = count + (rest > 0 ? 1 : 0);
    if (pool == 0) this.state.free_ready -= usedReady;
    else this.state.paid_ready -= usedReady;
    this.exhausted += count;
    if (rest > 0) { this.partialCount = 1; this.partialDeadline = this.now + rest; }
    this.insert(pool, this.exhausted, this.now + FULL);
    if (this.partialCount > 0) this.insert(pool, this.partialCount, this.partialDeadline);
  }
  summarize(a: token.account_state): token.account_state {
    a.resource_version = 2; a.block = this.now;
    a.free_ticks = this.capacity(0); a.token_ticks = this.capacity(1);
    a.free_credits = a.free_ticks / 144; a.token_credits = a.token_ticks / 144;
    a.transferable = this.state.paid_ready; a.locked = a.balance - a.transferable;
    a.recharge_blocks = FULL; a.ticks_per_unit = FULL;
    a.updated_at = Util.now();
    System.require(this.state.free_ready + this.get(0, 1, 0).count == 100, "free resource invariant");
    System.require(this.state.paid_ready + this.get(1, 1, 0).count == a.balance, "paid resource invariant");
    return a;
  }
  save(): void {
    const keys = this.dirty.values();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      this.nodes.put(Util.concat([this.account, Util.u32be(k)]), this.cache.get(k));
    }
    this.states.put(this.account, this.state);
  }
}
