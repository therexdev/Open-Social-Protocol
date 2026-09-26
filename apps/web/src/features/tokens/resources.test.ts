import { describe, expect, it } from "vitest";
import type { TokenAccount } from "@osp/sdk";
import { capacityLabel, tokenResources } from "./resources";
const base: TokenAccount = { balance: "100", free_credits: "0", token_credits: "20000", updated_at: "1" };
describe("token resource display", () => {
  it("distinguishes spendable pooled capacity from transferable units", () => {
    const r = tokenResources({ ...base, resource_version: 2, free_ticks: "0", token_ticks: "2880000", transferable: "0", locked: "100", ticks_per_unit: "144000" });
    expect(r.actions).toBe(20n);
    expect(r.ready).toBe(0n);
    expect(r.v2).toBe(true);
  });
  it("adds exact fractions across free and token capacity before rounding", () => {
    const r = tokenResources({ ...base, resource_version: 2, free_credits: "499", token_credits: "500", free_ticks: "71999", token_ticks: "72001", transferable: "0", ticks_per_unit: "144000" });
    expect(r.actions).toBe(1n);
  });
  it("never rounds partial capacity up to a whole action", () => {
    expect(capacityLabel(143999n, 144000n)).toBe("0.999");
    expect(capacityLabel(144000n, 144000n)).toBe("1.000");
  });
  it("detects old deployments and empty loading state", () => {
    expect(tokenResources(base)).toMatchObject({ v2: false, ready: 100n, actions: 20n });
    expect(tokenResources()).toMatchObject({ v2: false, ready: 0n, actions: 0n });
  });
});
