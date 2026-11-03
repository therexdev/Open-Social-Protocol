import { afterEach, expect, it, vi } from "vitest";
import { fakeProvider } from "../testing/fixtures.js";
import { waitForInclusion } from "./waitForInclusion.js";

afterEach(() => vi.useRealTimers());
const fixture = () => {
  const provider = fakeProvider();
  vi.spyOn(provider, "getTransactionsById").mockResolvedValue({ transactions: [{ transaction: { id: "tx" }, containing_blocks: ["fork", "canonical"] }] });
  vi.spyOn(provider, "getBlocksById").mockResolvedValue({ block_items: [
    { block_id: "fork", block_height: "40" }, { block_id: "canonical", block_height: "41" },
  ] } as never);
  vi.spyOn(provider, "getHeadInfo").mockResolvedValue({ head_topology: { id: "head", height: "43" } } as never);
  vi.spyOn(provider, "getBlocks").mockImplementation(async height => [{ block_id: height === 41 ? "canonical" : "other", block_height: String(height) }] as never);
  return provider;
};
it("checks the current fork with metadata-only reads and never broadcasts", async () => {
  const provider = fixture();
  await expect(waitForInclusion(provider, "tx")).resolves.toEqual({ blockId: "canonical", blockNumber: 41 });
  expect(provider.getBlocksById).toHaveBeenCalledWith(["fork", "canonical"], { returnBlock: false, returnReceipt: false });
  expect(provider.getBlocks).toHaveBeenCalledWith(41, 1, "head", { returnBlock: false, returnReceipt: false });
  expect(provider.sent).toHaveLength(0);
});
it("does not confirm a different transaction or a mempool-only transaction", async () => {
  vi.useFakeTimers();
  const provider = fixture();
  vi.mocked(provider.getTransactionsById).mockResolvedValue({ transactions: [{ transaction: { id: "unrelated" }, containing_blocks: ["canonical"] }] });
  const checked = expect(waitForInclusion(provider, "tx", 1100)).rejects.toThrow("not confirmed");
  await vi.advanceTimersByTimeAsync(1101); await checked;
  expect(provider.getBlocksById).not.toHaveBeenCalled();
  expect(provider.sent).toHaveLength(0);
});
it("polls a pending transaction until it appears without the initial one-second delay", async () => {
  vi.useFakeTimers();
  const provider = fixture();
  vi.mocked(provider.getTransactionsById).mockResolvedValueOnce({ transactions: [] });
  const pending = waitForInclusion(provider, "tx", 3000);
  expect(provider.getTransactionsById).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toEqual({ blockId: "canonical", blockNumber: 41 });
});
