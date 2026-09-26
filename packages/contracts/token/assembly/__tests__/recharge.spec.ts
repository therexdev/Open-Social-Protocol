import { Base58, MockVM } from "@koinos/sdk-as";
import { Recharge, FULL } from "../Recharge";
import { token } from "../proto/token";
import { Testing } from "../common/testing";
const ID = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu");
const ALICE = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe");
let cfg!: token.config;
let value!: token.account_state;
function open(block: u64): Recharge { return new Recharge(ID, ALICE, value, cfg, block); }
function commit(r: Recharge): void { value = r.summarize(value); r.save(); }
function seed(balance: u64, free: u64, paid: u64, block: u64 = 1): void {
  Testing.setup(ID);
  cfg = new token.config(); cfg.resource_version = 2; cfg.activation_block = block; cfg.activation_time = Testing.DEFAULT_TIME;
  value = new token.account_state(balance, free, paid, Testing.DEFAULT_TIME);
  commit(open(block));
}
function drainOracle(a: u64[], cost: u64): void {
  a.sort((x: u64, y: u64): i32 => x < y ? -1 : x > y ? 1 : 0);
  for (let i = 0; i < a.length && cost > 0; i++) { const used = min<u64>(a[i], cost); a[i] -= used; cost -= used; }
  expect(cost).toBe(0);
}
function capacity(a: u64[]): u64 { let total: u64 = 0; for (let i = 0; i < a.length; i++) total += a[i]; return total; }

describe("bounded five-day recharge ledger", (): void => {
  it("makes 100 depleted free units fund a whole action at block 1440, not before", (): void => {
    seed(0, 0, 0);
    expect(open(1440).capacity(0)).toBe(143900);
    const r = open(1441);
    expect(r.capacity(0)).toBe(FULL);
    r.spend(0, FULL); commit(r);
    expect(open(1441).capacity(0)).toBe(0);
    expect(open(2881).capacity(0)).toBe(FULL);
  });
  it("does not let a million unused tokens accelerate one spent token", (): void => {
    seed(1000000, 100000, 1000000000);
    const r = open(1); r.spend(1, FULL); commit(r);
    const next = open(28801);
    expect(next.capacity(1)).toBe(999999 * FULL + 28800);
    expect(next.summarize(value).transferable).toBe(999999);
    expect(next.summarize(value).locked).toBe(1);
  });
  it("does not unlock partially charged tokens even when their capacity pools", (): void => {
    seed(100, 0, 0);
    const r = open(28801);
    expect(r.capacity(1)).toBe(20 * FULL);
    expect(r.summarize(value).transferable).toBe(0);
    r.spend(1, 20 * FULL); commit(r);
    expect(open(144001).summarize(value).transferable).toBe(0);
    expect(open(172801).summarize(value).transferable).toBe(100);
  });
  it("preserves exact legacy credits, balance and cutoff recovery once", (): void => {
    seed(10, 12789, 2345);
    expect(open(1).capacity(0)).toBe(12789 * 144);
    expect(open(1).capacity(1)).toBe(2345 * 144);
    expect(open(1).summarize(value).transferable).toBe(2);
    const r = open(2); commit(r);
    expect(open(2).capacity(1)).toBe(2345 * 144 + 8);
    expect(open(2).capacity(0)).toBe(12789 * 144 + 88);
  });
  it("applies legacy recovery only until the authenticated activation time", (): void => {
    Testing.setup(ID);
    cfg = new token.config(); cfg.resource_version = 2; cfg.activation_block = 1; cfg.activation_time = Testing.DEFAULT_TIME;
    value = new token.account_state(10, 0, 0, Testing.DEFAULT_TIME - 43200000);
    const r = open(28801);
    expect(r.capacity(1)).toBe(5 * FULL + 5 * 28800);
    expect(r.capacity(0)).toBe(50 * FULL + 50 * 28800);
    commit(r);
    expect(open(28801).capacity(1)).toBe(6 * FULL);
  });
  it("keeps different histories independent across wraparound and full expiry", (): void => {
    seed(10, 100000, 10000, 250000);
    const a = open(250000); a.spend(1, FULL); commit(a);
    const b = open(270000); b.spend(1, FULL); commit(b);
    expect(open(393999).summarize(value).transferable).toBe(8);
    const c = open(394000); commit(c);
    // Reusing the first unit's 20k partial charge pushed its maturity to 414000.
    expect(c.state.paid_ready).toBe(9);
    expect(open(414000).summarize(value).transferable).toBe(10);
    const d = open(1000000); d.spend(1, FULL); commit(d);
    expect(open(1144000).summarize(value).transferable).toBe(10);
  });
  it("matches individual units through 1000 repeat uses, partial drains and wrapped epochs", (): void => {
    seed(12, 100000, 12000, 260000);
    const free = new Array<u64>(100), paid = new Array<u64>(12);
    free.fill(FULL); paid.fill(FULL);
    let block: u64 = 260000, random: u32 = 20260926;
    for (let turn = 0; turn < 1000; turn++) {
      random = random * 1664525 + 1013904223;
      const elapsed = u64(random % 4000);
      block += elapsed;
      for (let i = 0; i < free.length; i++) free[i] = min<u64>(FULL, free[i] + elapsed);
      for (let i = 0; i < paid.length; i++) paid[i] = min<u64>(FULL, paid[i] + elapsed);
      const r = open(block);
      const pool: u32 = turn % 3 == 0 ? 1 : 0;
      const oracle = pool == 0 ? free : paid;
      const cost = min<u64>(capacity(oracle), u64(random % 300000) + 1);
      drainOracle(oracle, cost); r.spend(pool, cost); commit(r);
      expect(r.capacity(0)).toBe(capacity(free));
      expect(r.capacity(1)).toBe(capacity(paid));
      let ready: u64 = 0; for (let i = 0; i < paid.length; i++) if (paid[i] == FULL) ready++;
      expect(value.transferable).toBe(ready);
      expect(r.reads).toBeLessThan(250);
      expect(r.dirty.size).toBeLessThan(250);
    }
  });
  it("bulk drains 1024 distinct histories with bounded reads and writes", (): void => {
    seed(1024, 100000, 1024000);
    const r = open(1); r.state.paid_ready = 0;
    let total: u64 = 0;
    for (let i: u64 = 1; i <= 1024; i++) { r.insert(1, 1, 1 + FULL - i); total += i; }
    commit(r);
    const next = open(1); next.spend(1, 3 * FULL); commit(next);
    expect(next.capacity(1)).toBe(total - 3 * FULL);
    expect(next.reads).toBeLessThan(150);
    expect(next.dirty.size).toBeLessThan(150);
    const recovered = open(2); commit(recovered);
    expect(recovered.capacity(1)).toBe(total - 3 * FULL + 1024);
  });
  it("read-only recovery never stores or truncates partial ticks", (): void => {
    seed(1, 0, 0);
    for (let block: u64 = 2; block <= 1001; block++) expect(open(block).capacity(1)).toBe(block - 1);
    expect(open(144001).summarize(value).transferable).toBe(1);
  });
});
