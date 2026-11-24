import type { ProviderInterface, TransactionReceipt } from "koilib";

type HeadProvider = Pick<ProviderInterface, "getHeadInfo">;
type ConfirmationProvider = HeadProvider & Pick<ProviderInterface, "getBlocks">;

/** HTTP health is insufficient: a responding RPC can serve a halted/stale chain. */
export async function requireFreshDeploymentHead(provider: HeadProvider, options: { now?: () => number; maxAgeMs?: number } = {}) {
  const head = await provider.getHeadInfo(), now = (options.now ?? Date.now)();
  const height = Number(head.head_topology.height), timestamp = Number(head.head_block_time);
  if (!head.head_topology.id || !Number.isSafeInteger(height) || height < 1 || !Number.isSafeInteger(timestamp) || timestamp < 1 || timestamp > now + 60_000)
    throw new Error("The chain RPC returned invalid head information. No new deployment transaction will be submitted against this head.");
  const age = now - timestamp;
  if (age > (options.maxAgeMs ?? 180_000)) {
    throw new Error(`Chain RPC is stale or block production has stopped: head ${height}, last block ${new Date(timestamp).toISOString()} (${Math.floor(age / 1000)} seconds old). No new deployment transaction will be submitted against this head. Wait for a fresh, advancing testnet or use a healthy RPC for the same chain.`);
  }
  return head;
}

export class DeploymentTransactionRevertedError extends Error {}

/** Scan canonical receipts from the head observed BEFORE broadcast. Unlike a
 * forward scan initialized after broadcast, this also finds a fast confirmation
 * that predates the first poll. Only RPCs already supported by the testnet are used.
 * This function never submits or re-signs a transaction. */
export async function confirmDeploymentTransaction(
  provider: ConfirmationProvider,
  txId: string,
  startHeight: number,
  options: { timeoutMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; log?: (message: string) => void } = {},
): Promise<{ blockId: string; blockNumber: number; receipt: TransactionReceipt }> {
  if (!txId || !Number.isSafeInteger(startHeight) || startHeight < 1) throw new Error("Invalid deployment confirmation checkpoint");
  const now = options.now ?? Date.now, timeout = options.timeoutMs ?? 600_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1) throw new Error("Invalid deployment confirmation timeout");
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = now() + timeout;
  let nextLog = 0, lastHead = "unknown", lastError = "";
  while (now() < deadline) {
    try {
      const head = await provider.getHeadInfo(), height = Number(head.head_topology.height);
      if (!Number.isSafeInteger(height) || height < 1 || !head.head_topology.id) throw new Error("Invalid RPC head");
      lastHead = `${height} (${new Date(Number(head.head_block_time)).toISOString()})`;
      // Receipts avoid downloading every full contract upload / block body.
      // Rescan against this head so fork changes cannot leave an orphan accepted
      // or an earlier canonical inclusion permanently skipped.
      for (let from = startHeight; from <= height && now() < deadline; from += 64) {
        const count = Math.min(64, height - from + 1);
        const blocks = await provider.getBlocks(from, count, head.head_topology.id, { returnBlock: false, returnReceipt: true });
        for (const block of blocks) {
          const blockNumber = Number(block.block_height);
          if (!block.block_id || !Number.isSafeInteger(blockNumber) || blockNumber < from || blockNumber >= from + count) continue;
          const receipt = block.receipt?.transaction_receipts?.find(r => r.id === txId);
          if (!receipt || receipt.rpc_error) continue;
          if (receipt.reverted) throw new DeploymentTransactionRevertedError(`Deployment transaction ${txId} reverted in block ${blockNumber}: ${(receipt.logs ?? []).join("; ")}`);
          return { blockId: block.block_id, blockNumber, receipt };
        }
      }
      lastError = "";
    } catch (error) {
      if (error instanceof DeploymentTransactionRevertedError) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (now() >= nextLog) {
      options.log?.(`waiting for transaction ${txId}; RPC head ${lastHead}${lastError ? `; ${lastError}` : ""}`);
      nextLog = now() + 15_000;
    }
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(2000, remaining));
  }
  throw new Error(`Confirmation of deployment transaction ${txId} is still unknown after ${timeout} ms; RPC head ${lastHead}${lastError ? `; last RPC error: ${lastError}` : ""}. The upload checkpoint is preserved. Start a new workflow run after the chain RPC is healthy to reconcile this transaction before another upload.`);
}
