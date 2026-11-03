import type { ProviderInterface } from "koilib";

/** Confirm inclusion on the current fork without downloading block bodies/receipts.
 * This is inclusion (like koilib.wait), not irreversible finality. Never broadcasts. */
export async function waitForInclusion(provider: ProviderInterface, txId: string, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  const metadata = { returnBlock: false, returnReceipt: false };
  while (Date.now() < deadline) {
    const result = await provider.getTransactionsById([txId]);
    const candidate = result.transactions?.find(item => item.transaction?.id === txId);
    const ids = [...new Set(candidate?.containing_blocks ?? [])];
    if (ids.length) {
      const blocks = await provider.getBlocksById(ids, metadata);
      const head = (await provider.getHeadInfo()).head_topology;
      for (const block of blocks.block_items ?? []) {
        const height = Number(block.block_height);
        if (!ids.includes(block.block_id) || !Number.isSafeInteger(height) || height < 1 || height > Number(head.height)) continue;
        const canonical = await provider.getBlocks(height, 1, head.id, metadata);
        if (canonical.some(item => item.block_id === block.block_id && Number(item.block_height) === height)) {
          return { blockId: block.block_id, blockNumber: height };
        }
      }
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(1000, remaining)));
  }
  throw new Error(`Transaction inclusion was not confirmed within ${timeout} ms`);
}
