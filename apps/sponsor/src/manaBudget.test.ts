import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInterface } from "@osp/sdk";
import { ManaBudget } from "./manaBudget.js";

const TODAY = Date.parse("2026-11-23T23:59:00Z"), LIMIT = "5000000000";
const files: string[] = [], stores: ManaBudget[] = [];
const open = (path = ":memory:", limit = LIMIT) => { const b = new ManaBudget(path, "chain:identity:payer", limit); stores.push(b); return b; };
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const p of files.splice(0)) rmSync(p, { recursive: true, force: true }); });
function provider(receipts: Array<Record<string, unknown>>, lib = 101): ProviderInterface {
  return {
    getHeadInfo: async () => ({ last_irreversible_block: String(lib), head_topology: { id: "canonical-head", height: "150" } }),
    getBlocks: async (from: number, count: number) => Array.from({ length: count }, (_,i) => ({ block_id: `b${from+i}`, block_height: String(from+i),
      receipt: { id: `b${from+i}`, transaction_receipts: from+i === 101 ? receipts : [] } })),
  } as unknown as ProviderInterface;
}
describe("daily sponsored Mana liability", () => {
  it("holds full signed limits, refuses overspend, isolates accounts and blocks duplicate IDs", () => {
    const b = open(); b.reserve("a", "alice", "3000000000", 100, TODAY);
    expect(b.allowance("alice", TODAY).remainingRc).toBe("2000000000");
    expect(() => b.reserve("b", "alice", "3000000000", 100, TODAY)).toThrow("allowance exhausted");
    expect(() => b.reserve("a", "alice", "1", 100, TODAY)).toThrow("already submitted");
    b.reserve("c", "bob", LIMIT, 100, TODAY);
    expect(b.allowance("bob", TODAY).remainingRc).toBe("0");
  });
  it("releases exclusively unsent signatures and charges no aggregate consumption prematurely", () => {
    const b = open(); b.reserve("a", "alice", LIMIT, 100, TODAY);
    expect(b.aggregate(TODAY).usedRc).toBe("0");
    expect(b.aggregate(TODAY).reservedRc).toBe(LIMIT);
    b.releaseUnsent("a"); expect(b.allowance("alice", TODAY).remainingRc).toBe(LIMIT);
  });
  it("serializes reservations across processes, persists unknowns and retains usage when lowering the cap", () => {
    const dir = mkdtempSync(join(tmpdir(), "osp-mana-")); files.push(dir);
    const path = join(dir,"budget.sqlite"), a = open(path), b = open(path);
    a.reserve("a", "alice", "3000000000", 100, TODAY);
    expect(() => b.reserve("b", "alice", "3000000000", 100, TODAY)).toThrow("allowance exhausted");
    const lower = open(path, "2500000000");
    expect(lower.pending()[0]?.id).toBe("a");
    expect(lower.allowance("alice", TODAY).remainingRc).toBe("0");
  });
  it("resets exactly at UTC midnight without erasing previous-day pending transactions", () => {
    const b = open(); b.reserve("a", "alice", LIMIT, 100, TODAY);
    expect(b.allowance("alice", TODAY).resetsAt).toBe("2026-11-24T00:00:00.000Z");
    expect(b.allowance("alice", TODAY+60000).remainingRc).toBe(LIMIT);
    expect(b.pending()).toHaveLength(1);
  });
  it("uses irreversible canonical receipts, frees unused liability and counts reverted Mana", async () => {
    const b = open(); b.reserve("a", "alice", LIMIT, 100, TODAY);
    await b.reconcile(provider([{ id:"a", payer:"payer", rc_used:"123", reverted:true }],100), "payer");
    expect(b.allowance("alice", TODAY).reservedRc).toBe(LIMIT);
    await b.reconcile(provider([{ id:"a", payer:"payer", rc_used:"123", reverted:true }]), "payer");
    expect(b.allowance("alice", TODAY)).toMatchObject({ usedRc:"123", reservedRc:"0", remainingRc:"4999999877" });
    expect(b.aggregate(TODAY).reverted).toBe(1);
    await b.reconcile(provider([{ id:"a", payer:"payer", rc_used:"123", reverted:true }]), "payer");
    expect(b.aggregate(TODAY).usedRc).toBe("123");
  });
  it("retains unknowns, ignores mempool-style rpc errors, and never clears a hold by timeout", async () => {
    const b = open(); b.reserve("a", "alice", LIMIT, 100, TODAY);
    await b.reconcile(provider([{ id:"a", payer:"payer", rc_used:"1", rpc_error:"timeout" }]), "payer");
    expect(b.allowance("alice", TODAY).reservedRc).toBe(LIMIT);
    expect(b.pending()).toHaveLength(1);
  });
  it("fails closed on incomplete block receipts, mismatched payers and excess RC", async () => {
    const b = open(); b.reserve("a", "alice", "100", 100, TODAY);
    const partial = provider([]); partial.getBlocks = async () => [];
    await expect(b.reconcile(partial,"payer")).rejects.toThrow("Incomplete canonical");
    expect(b.pending()[0]?.cursor).toBe(99);
    await expect(b.reconcile(provider([{id:"a",payer:"other",rc_used:"1"}]),"payer")).rejects.toThrow("liability");
    await expect(b.reconcile(provider([{id:"a",payer:"payer",rc_used:"101"}]),"payer")).rejects.toThrow("liability");
    expect(b.allowance("alice",TODAY).reservedRc).toBe("100");
  });
  it("does not overcommit the shared sponsor pool across accounts or UTC days", () => {
    const b = open(); b.reserve("a", "alice", "100", 100, TODAY, "150");
    expect(() => b.reserve("b","bob","100",100,TODAY+86400000,"150")).toThrow("pool is busy or depleted");
    expect(b.allowance("bob",TODAY+86400000).reservedRc).toBe("0");
  });
  it("binds private aliases to one durable parent and keeps recovery ownership current", () => {
    const dir = mkdtempSync(join(tmpdir(), "osp-mana-")); files.push(dir);
    const path = join(dir,"budget.sqlite"), a = open(path);
    a.bindAlias("alias-1","alice","owner-1"); a.bindAlias("alias-2","alice","owner-1");
    expect(() => a.bindAlias("alias-1","bob","bob-owner")).toThrow("another account");
    expect(() => a.bindAlias("alias-3","alias-1","owner-1")).toThrow("another account's allowance");
    const b = open(path); expect(b.aliasAccount("alias-2")).toBe("alice");
    b.bindAlias("alias-1","alice","owner-2"); expect(a.aliasOwner("alias-1")).toBe("owner-2");
  });
  it("rejects negative, unsafe and zero limits", () => {
    expect(() => open(":memory:", "9007199254740992")).toThrow("Invalid RC");
    const b = open(); expect(() => b.reserve("a","alice","0",100,TODAY)).toThrow("Invalid Mana");
  });
});

it("does not advance an unprocessed transaction beyond its receipt when a reconciliation batch is full", async () => {
  const b=open(); for(let i=0;i<1001;i++) b.reserve(`t${i}`,`account${i}`,"1",100,TODAY);
  const p=provider([{id:"t1000",payer:"payer",rc_used:"1"}]);
  await b.reconcile(p,"payer");
  await b.reconcile(p,"payer");
  expect(b.allowance("account1000",TODAY)).toMatchObject({usedRc:"1",reservedRc:"0"});
});
