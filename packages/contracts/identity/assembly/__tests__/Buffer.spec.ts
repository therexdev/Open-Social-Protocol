import { System, MockVM, Base58 } from "@koinos/sdk-as";
import { Identity } from "../Identity";
import { Testing } from "../common/testing";

const CONTRACT_ID = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe");

describe("system-call buffer", () => {
  beforeEach(() => {
    Testing.setup(CONTRACT_ID);
  });

  it("accepts call arguments far larger than the SDK default 1 KiB buffer", () => {
    // Importing the contract module runs its top-level buffer resize.
    const c = new Identity();
    expect(c.contractId.length).toBe(25);
    expect(System.getSystemBufferSize() >= 32 * 1024).toBe(true);
    const big = new Uint8Array(20000);
    for (let i = 0; i < big.length; i++) big[i] = <u8>(i & 0x7f);
    MockVM.setContractArguments(big);
    System.resetCache();
    const args = System.getArguments();
    expect(args.args.length).toBe(20000);
    expect(args.args[19999]).toBe(<u8>(19999 & 0x7f));
  });
});
