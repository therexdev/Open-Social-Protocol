/**
 * Token v2 resource-accounting reference model. NOT a deployed contract or wallet.
 *
 * Each unit has one fixed recharge stream. Cohorts compress identical units only;
 * averaging differently charged units would let some recharge earlier than they should.
 * All operations are immutable, so a rejected operation has no partial side effects.
 * The on-chain port must establish bounded storage and execution independently.
 */
export const RECHARGE_BLOCKS = 144_000n;
/** One internal tick is 1/144000 of one action/token's capacity. */
export const FULL = RECHARGE_BLOCKS;
export const BASELINE_FREE_UNITS = 100n;

export interface Cohort {
  readonly count: bigint;
  readonly charge: bigint;
}

export interface Account {
  readonly id: string;
  readonly block: bigint;
  readonly free: readonly Cohort[];
  readonly paid: readonly Cohort[];
}

export interface Summary {
  readonly balance: bigint;
  readonly transferable: bigint;
  readonly locked: bigint;
  readonly freeCapacity: bigint;
  readonly tokenCapacity: bigint;
  readonly availableActions: bigint;
  readonly availableVoteWeight: bigint;
}

function natural(value: bigint, name: string): void {
  if (typeof value !== "bigint" || value < 0n) throw new Error(`${name} must be a nonnegative bigint`);
}

function positive(value: bigint, name: string): void {
  natural(value, name);
  if (value === 0n) throw new Error(`${name} must be positive`);
}

function canonical(pool: readonly Cohort[]): Cohort[] {
  const charges = new Map<bigint, bigint>();
  for (const { count, charge } of pool) {
    positive(count, "cohort count");
    natural(charge, "cohort charge");
    if (charge > FULL) throw new Error("cohort charge exceeds full capacity");
    charges.set(charge, (charges.get(charge) ?? 0n) + count);
  }
  return [...charges].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([charge, count]) => ({ count, charge }));
}

function capacity(pool: readonly Cohort[]): bigint {
  return pool.reduce((sum, c) => sum + c.count * c.charge, 0n);
}

function units(pool: readonly Cohort[]): bigint {
  return pool.reduce((sum, c) => sum + c.count, 0n);
}

function fullUnits(pool: readonly Cohort[]): bigint {
  return pool.reduce((sum, c) => sum + (c.charge === FULL ? c.count : 0n), 0n);
}

function recharge(pool: readonly Cohort[], elapsed: bigint): Cohort[] {
  return canonical(canonical(pool).map(c => ({ count: c.count, charge: c.charge + elapsed > FULL ? FULL : c.charge + elapsed })));
}

/** Fixture constructor only: it does not authorize issuance or an onboarding grant. */
export function account(id: string, paid = 0n, free = BASELINE_FREE_UNITS, block = 0n): Account {
  if (!id) throw new Error("account id is required");
  natural(paid, "paid units");
  natural(free, "free units");
  natural(block, "block");
  return {
    id, block,
    free: free ? [{ count: free, charge: FULL }] : [],
    paid: paid ? [{ count: paid, charge: FULL }] : [],
  };
}

/** Every used unit advances at one tick/block, independent of idle units or reads. */
export function at(a: Account, block: bigint): Account {
  natural(a.block, "account block");
  natural(block, "block");
  if (block < a.block) throw new Error("block cannot move backwards");
  const elapsed = block - a.block;
  return { id: a.id, block, free: recharge(a.free, elapsed), paid: recharge(a.paid, elapsed) };
}

export function summary(a: Account, block = a.block): Summary {
  const s = at(a, block);
  const balance = units(s.paid), transferable = fullUnits(s.paid);
  const freeCapacity = capacity(s.free), tokenCapacity = capacity(s.paid);
  return {
    balance, transferable, locked: balance - transferable,
    freeCapacity, tokenCapacity,
    availableActions: (freeCapacity + tokenCapacity) / FULL,
    availableVoteWeight: tokenCapacity / FULL,
  };
}

/**
 * Consume the least charged usable units first, splitting cohorts exactly.
 * Combining fractions spends capacity; it never combines their recharge streams,
 * converts partially charged units into transferable tokens, or adds new units.
 */
function drain(pool: readonly Cohort[], cost: bigint): Cohort[] {
  natural(cost, "cost");
  if (capacity(pool) < cost) throw new Error("insufficient capacity");
  let remaining = cost;
  const out: Cohort[] = [];
  for (const c of canonical(pool)) {
    if (!remaining || !c.charge) { out.push(c); continue; }
    const exhausted = remaining / c.charge < c.count ? remaining / c.charge : c.count;
    if (exhausted) out.push({ count: exhausted, charge: 0n });
    remaining -= exhausted * c.charge;
    let untouched = c.count - exhausted;
    if (untouched && remaining) {
      out.push({ count: 1n, charge: c.charge - remaining });
      untouched--;
      remaining = 0n;
    }
    if (untouched) out.push({ count: untouched, charge: c.charge });
  }
  if (remaining) throw new Error("capacity accounting error");
  return canonical(out);
}

/** Actions may combine fractional free and paid capacity, using free capacity first. */
export function useActions(a: Account, block: bigint, count = 1n): Account {
  positive(count, "action count");
  const s = at(a, block), cost = count * FULL;
  const freeCost = capacity(s.free) < cost ? capacity(s.free) : cost;
  if (capacity(s.paid) < cost - freeCost) throw new Error("insufficient action capacity");
  return { ...s, free: drain(s.free, freeCost), paid: drain(s.paid, cost - freeCost) };
}

/**
 * Resource charge for EITHER voting direction, in whole units of weight.
 * This is not vote recording, post eligibility, voter authorization or settlement.
 * Those rules require the separately versioned voting contract integration.
 */
export function useVoteWeight(a: Account, block: bigint, weight = 1n): Account {
  positive(weight, "vote weight");
  const s = at(a, block);
  if (capacity(s.paid) < weight * FULL) throw new Error("insufficient token voting capacity");
  return { ...s, paid: drain(s.paid, weight * FULL) };
}

function removeReady(pool: readonly Cohort[], count: bigint): Cohort[] {
  if (fullUnits(pool) < count) throw new Error("tokens are locked until fully recharged");
  const out: Cohort[] = [];
  for (const c of canonical(pool)) {
    const left = c.count - (c.charge === FULL ? count : 0n);
    if (left) out.push({ count: left, charge: c.charge });
  }
  return out;
}

/** A transfer moves fully charged paid units. Free capacity never moves or refills. */
export function transfer(from: Account, to: Account, block: bigint, count: bigint): { from: Account; to: Account } {
  positive(count, "transfer amount");
  if (from.id === to.id) throw new Error("cannot transfer to the same account");
  const sender = at(from, block), recipient = at(to, block);
  const paid = removeReady(sender.paid, count);
  return {
    from: { ...sender, paid },
    to: { ...recipient, paid: canonical([...recipient.paid, { count, charge: FULL }]) },
  };
}

/** Resource side of a future promotion burn; no campaign or reach is created here. */
export function burn(a: Account, block: bigint, count: bigint): Account {
  positive(count, "burn amount");
  const s = at(a, block);
  return { ...s, paid: removeReady(s.paid, count) };
}

/** Exact internal tick count; use a formatted decimal only at the presentation layer. */
export function availableCapacity(a: Account, block = a.block): bigint {
  const s = summary(a, block);
  return s.freeCapacity + s.tokenCapacity;
}

/**
 * Candidate migration mapping, not authorization to migrate live balances.
 * Preserve legacy capacity exactly (legacy unit = 1000 resource units), without
 * inventing past per-token histories: full units, at most one partial, then empty.
 * The cutoff block and authenticated snapshot must be supplied by the migration.
 */
export function fromLegacySnapshot(
  id: string, balance: bigint, freeCredits: bigint, tokenCredits: bigint, block: bigint,
): Account {
  const initial = account(id, balance, BASELINE_FREE_UNITS, block);
  const convert = (count: bigint, credits: bigint): Cohort[] => {
    natural(credits, "legacy credits");
    if (credits > count * 1000n) throw new Error("legacy credits exceed capacity");
    const full = credits / 1000n, remainder = credits % 1000n;
    const empty = count - full - (remainder ? 1n : 0n);
    return canonical([
      ...(full ? [{ count: full, charge: FULL }] : []),
      ...(remainder ? [{ count: 1n, charge: remainder * (FULL / 1000n) }] : []),
      ...(empty ? [{ count: empty, charge: 0n }] : []),
    ]);
  };
  return { ...initial, free: convert(BASELINE_FREE_UNITS, freeCredits), paid: convert(balance, tokenCredits) };
}
