import assert from "node:assert/strict";
import test from "node:test";
import {
  account, at, availableCapacity, burn, fromLegacySnapshot, FULL, RECHARGE_BLOCKS, summary, transfer, useActions, useVoteWeight,
  type Account,
} from "../research/token-v2/model.js";

const DAY = RECHARGE_BLOCKS / 5n;

test("one depleted token takes five days regardless of untouched holdings", () => {
  for (const balance of [1n, 100n, 1_000_000n]) {
    const a = useActions(account("a", balance, 0n), 0n);
    const s = summary(a, DAY);
    assert.equal(s.tokenCapacity - (balance - 1n) * FULL, FULL / 5n);
    assert.equal(s.transferable, balance - 1n);
    assert.equal(summary(a, RECHARGE_BLOCKS - 1n).locked, 1n);
    assert.equal(summary(a, RECHARGE_BLOCKS).locked, 0n);
  }
});

test("100 exhausted free credits combine into one action after 1440 blocks", () => {
  const empty = useActions(account("a"), 0n, 100n);
  assert.equal(summary(empty, 1439n).availableActions, 0n);
  assert.throws(() => useActions(empty, 1439n), /insufficient/);
  const next = useActions(empty, 1440n);
  assert.equal(availableCapacity(next), 0n);
  assert.equal(summary(next).balance, 0n);
  assert.equal(summary(empty, DAY).availableActions, 20n);
  assert.equal(summary(empty, RECHARGE_BLOCKS).availableActions, 100n);
});

test("using only one free credit does not borrow recharge from the other 99", () => {
  const a = useActions(account("a"), 0n);
  assert.equal(summary(a, DAY).freeCapacity, 99n * FULL + FULL / 5n);
});

test("reading or updating every block does not lose recharge fractions", () => {
  const start = useActions(account("a", 7n, 0n), 0n, 7n);
  let stepped = start;
  for (let block = 1n; block <= 4321n; block++) stepped = at(stepped, block);
  assert.deepEqual(stepped, at(start, 4321n));
  assert.equal(availableCapacity(stepped), 7n * 4321n);
});

test("tokens and free credits recharge identically but only paid capacity can vote", () => {
  const empty = useActions(account("a", 100n, 100n), 0n, 200n);
  const recovered = summary(empty, DAY);
  assert.equal(recovered.freeCapacity, recovered.tokenCapacity);
  assert.equal(recovered.availableVoteWeight, 20n);
  assert.throws(() => useVoteWeight(account("free-only"), 0n), /insufficient token/);
  const voted = useVoteWeight(empty, DAY, 20n);
  assert.equal(summary(voted).freeCapacity, 20n * FULL);
  assert.equal(summary(voted).tokenCapacity, 0n);
});

test("actions and votes draw from the same paid capacity and share one recharge rate", () => {
  const start = account("a", 100n, 0n);
  const spent = useActions(start, 0n, 40n);
  assert.equal(summary(spent).availableVoteWeight, 60n);
  const voted = useVoteWeight(spent, 0n, 60n);
  assert.equal(summary(voted).availableActions, 0n);
  assert.equal(summary(voted).locked, 100n);
  assert.throws(() => useActions(voted, 0n), /insufficient/);
  assert.deepEqual(summary(voted, DAY), summary(useActions(start, 0n, 100n), DAY));
});

test("weight costs scale linearly and rejected charges are atomic", () => {
  const a = account("a", 25n, 100n);
  const original = structuredClone(a);
  assert.throws(() => useVoteWeight(a, 0n, 26n), /insufficient/);
  assert.throws(() => useActions(a, 0n, 126n), /insufficient/);
  assert.deepEqual(a, original);
  assert.equal(summary(useVoteWeight(a, 0n, 20n)).tokenCapacity, 5n * FULL);
});

test("different recharge histories remain independent when capacity is reused", () => {
  const first = useActions(account("a", 2n, 0n), 0n);
  const second = useActions(first, DAY);
  // Use the recovered 0.2 first, then 0.8 from the second token: no averaging.
  assert.deepEqual(second.paid, [{ count: 1n, charge: 0n }, { count: 1n, charge: DAY }]);
  assert.equal(summary(second, 5n * DAY).transferable, 1n);
  assert.equal(summary(second, 5n * DAY).locked, 1n);
  assert.equal(summary(second, 6n * DAY).transferable, 2n);
});

test("fractions combine across free and paid capacity without generating extra units", () => {
  const empty = useActions(account("a", 1n, 1n), 0n, 2n);
  const spent = useActions(empty, RECHARGE_BLOCKS / 2n);
  assert.equal(availableCapacity(spent), 0n);
  assert.equal(summary(spent).balance, 1n);
  assert.equal(spent.free.reduce((n, c) => n + c.count, 0n), 1n);
});

test("recovered fractions are usable but do not unlock partially charged tokens", () => {
  const empty = useActions(account("a", 100n, 0n), 0n, 100n);
  assert.equal(summary(empty, DAY).availableActions, 20n);
  assert.equal(summary(empty, DAY).transferable, 0n);
  assert.throws(() => transfer(empty, account("b"), DAY, 1n), /locked/);
  assert.throws(() => burn(empty, DAY, 1n), /locked/);
  assert.equal(summary(useActions(empty, DAY, 20n)).locked, 100n);
});

test("1000 use/recharge cycles do not multiply capacity or recharge streams", () => {
  let a = useActions(account("a", 100n, 0n), 0n, 100n);
  for (let i = 1n; i <= 1000n; i++) {
    const block = i * 1440n;
    assert.equal(summary(a, block).tokenCapacity, FULL);
    a = useActions(a, block);
    assert.equal(summary(a).tokenCapacity, 0n);
    assert.deepEqual(a.paid, [{ count: 100n, charge: 0n }]);
  }
});

test("transfers cannot move depleted units or refill either account", () => {
  const start = useActions(account("a", 10n, 0n), 0n, 5n);
  const b = useActions(account("b", 0n, 100n), 0n, 100n);
  assert.throws(() => transfer(start, b, 0n, 6n), /locked/);
  const moved = transfer(start, b, DAY, 5n);
  assert.equal(summary(moved.from).balance, 5n);
  assert.equal(summary(moved.from).locked, 5n);
  assert.equal(summary(moved.to).balance, 5n);
  assert.equal(summary(moved.to).freeCapacity, summary(b, DAY).freeCapacity);
  const returned = transfer(moved.to, moved.from, DAY, 5n);
  assert.deepEqual(summary(returned.to), summary(start, DAY));
  assert.deepEqual(summary(returned.from), summary(b, DAY));
});

test("incoming tokens add capacity without accelerating previously depleted units", () => {
  const empty = useActions(account("a", 1n, 0n), 0n);
  const moved = transfer(account("donor", 1000n, 0n), empty, DAY, 1000n);
  const s = summary(moved.to, 2n * DAY);
  assert.equal(s.tokenCapacity - 1000n * FULL, 2n * DAY);
  assert.equal(s.locked, 1n);
});

test("burn removes tokens and future capacity permanently without touching free credits", () => {
  const start = useActions(account("a", 10n, 0n), 0n, 5n);
  const burned = burn(start, DAY, 5n);
  assert.equal(summary(burned).balance, 5n);
  assert.equal(summary(burned).tokenCapacity, 5n * DAY);
  assert.equal(summary(burned, 10n * DAY).tokenCapacity, 5n * FULL);
  assert.equal(summary(burned, 10n * DAY).balance, 5n);
});

test("invalid amounts, backwards time, and self-transfers are rejected", () => {
  const a = account("a", 10n);
  for (const n of [0n, -1n]) {
    assert.throws(() => useActions(a, 0n, n));
    assert.throws(() => useVoteWeight(a, 0n, n));
    assert.throws(() => transfer(a, account("b"), 0n, n));
    assert.throws(() => burn(a, 0n, n));
  }
  assert.throws(() => at(a, -1n));
  assert.throws(() => at(at(a, 10n), 9n));
  assert.throws(() => transfer(a, a, 0n, 1n));
  assert.throws(() => account("a", -1n));
  assert.throws(() => at({ ...a, paid: [{ count: 1n, charge: -1n }] }, 100n));
  assert.throws(() => at({ ...a, paid: [{ count: 1n, charge: FULL + 1n }] }, 100n));
});

test("candidate migration preserves balances and fractional capacity without refilling", () => {
  const migrated = fromLegacySnapshot("legacy", 10n, 50123n, 2345n, 800000n);
  const s = summary(migrated);
  assert.equal(s.balance, 10n);
  assert.equal(s.freeCapacity, 50123n * 144n);
  assert.equal(s.tokenCapacity, 2345n * 144n);
  assert.equal(s.transferable, 2n);
  assert.equal(s.locked, 8n);
  assert.throws(() => fromLegacySnapshot("a", 1n, 100001n, 1000n, 0n));
  assert.throws(() => fromLegacySnapshot("a", 1n, 100000n, 1001n, 0n));
  assert.throws(() => fromLegacySnapshot("a", 1n, -1n, 0n, 0n));
  assert.equal(summary(fromLegacySnapshot("a", 0n, 0n, 0n, 0n)).availableActions, 0n);
});

/** Independent per-unit oracle: no cohort arithmetic or grouping. */
test("cohort implementation matches individual units across 3000 deterministic operations", () => {
  let modeled: Account = account("a", 17n, 13n);
  const paid = Array<bigint>(17).fill(FULL), free = Array<bigint>(13).fill(FULL);
  let block = 0n, seed = 918273;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const total = (xs: bigint[]) => xs.reduce((n, x) => n + x, 0n);
  const drain = (xs: bigint[], amount: bigint) => {
    xs.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    for (let i = 0; i < xs.length && amount; i++) {
      const used = xs[i]! < amount ? xs[i]! : amount;
      xs[i] = xs[i]! - used;
      amount -= used;
    }
    assert.equal(amount, 0n);
  };
  for (let i = 0; i < 3000; i++) {
    const delta = BigInt(random() % 8000);
    block += delta;
    for (const xs of [paid, free]) for (let j = 0; j < xs.length; j++) xs[j] = xs[j]! + delta > FULL ? FULL : xs[j]! + delta;
    const vote = random() % 2 === 0, cost = BigInt(1 + random() % 5) * FULL;
    const possible = (vote ? total(paid) : total(paid) + total(free)) >= cost;
    if (possible) {
      modeled = vote ? useVoteWeight(modeled, block, cost / FULL) : useActions(modeled, block, cost / FULL);
      const freeCost = vote ? 0n : total(free) < cost ? total(free) : cost;
      drain(free, freeCost); drain(paid, cost - freeCost);
    } else {
      assert.throws(() => vote ? useVoteWeight(modeled, block, cost / FULL) : useActions(modeled, block, cost / FULL));
    }
    const s = summary(modeled, block);
    assert.equal(s.freeCapacity, total(free));
    assert.equal(s.tokenCapacity, total(paid));
    assert.equal(s.transferable, BigInt(paid.filter(x => x === FULL).length));
    assert.equal(s.balance, 17n);
  }
});
