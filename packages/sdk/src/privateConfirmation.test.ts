import { describe, expect, it } from "vitest";
import { privateConfirmationDepth, privateConfirmationHeight } from "./privateConfirmation.js";
describe("private testnet confirmation policy", () => {
  it("uses three confirmations on Harbinger and full finality on other networks", () => {
    expect(privateConfirmationDepth("harbinger")).toBe(3);
    expect(privateConfirmationDepth("mainnet")).toBe(0);
    expect(privateConfirmationDepth("unknown")).toBe(0);
    const head = { head_topology: { height: "100" }, last_irreversible_block: "40" };
    expect(privateConfirmationHeight(head, 3)).toBe(98n);
    expect(privateConfirmationHeight(head, 0)).toBe(40n);
    expect(privateConfirmationHeight({ last_irreversible_block: "40" }, 3)).toBe(40n);
  });
});
