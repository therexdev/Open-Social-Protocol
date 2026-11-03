import { walletBalance, walletTransferOperation, type TransactionJson, type WalletBalance, type ProtocolClient } from "@osp/sdk";
import { submitAction, withAccountSubmission, type SubmitContext } from "../../tx/submit";
import { deriveAesKey, EncryptedStore } from "../../vault/encryptedStore";
import { defaultStorage } from "../../vault/storage";
import type { Session } from "../../vault/store";

export interface WalletReview { balance: WalletBalance; to: string; amount: string; all: boolean; account: string }
export interface PendingWalletTransfer extends WalletReview { transaction: TransactionJson; createdAt: number }
export type TransferStore = Pick<EncryptedStore<PendingWalletTransfer>, "load" | "save" | "clear">;
export async function walletTransferStore(session: Session, client: ProtocolClient): Promise<EncryptedStore<PendingWalletTransfer>> {
  if (typeof window !== "undefined" && typeof indexedDB === "undefined") throw new Error("Enable browser storage to keep your wallet transfer status before sending.");
  const scope = `${client.chainId}:${client.deployment.contracts.token.address}:${session.identity.account}:${session.identity.signer.getAddress()}`;
  return new EncryptedStore(defaultStorage(), `osp.web.wallet.${scope}`, await deriveAesKey(session.identity.seed, `wallet:${scope}`));
}
export function transferOutcomeUnknown(error: unknown): boolean {
  let current = error;
  for (let n = 0; n < 5 && current instanceof Error; n++) {
    if (current.name === "TransactionOutcomeUnknownError") return true;
    current = current.cause;
  }
  return false;
}
export async function sendWalletTransfer(ctx: SubmitContext, review: WalletReview, store: TransferStore, onPending?: (pending: PendingWalletTransfer) => void): Promise<string> {
  const operation = await walletTransferOperation(ctx.client, review.balance, review.to, review.amount);
  let savedId: string | undefined;
  const clearOwnRecord = () => withAccountSubmission(ctx, async () => {
    if (savedId && (await store.load())?.transaction.id === savedId) await store.clear();
  });
  try {
    const result = await submitAction({ ...ctx, payment: "sponsor-only" }, [operation], {
      label: `Sending ${review.balance.symbol}`,
      success: `${review.balance.symbol} transferred`,
      waitForReceipt: true,
      beforeSubmit: async () => {
        if (await store.load()) throw new Error("Check the pending wallet transfer before sending another.");
        const fresh = await walletBalance(ctx.client, review.balance.token, review.account, ctx.signer.getAddress());
        if (fresh.address !== review.balance.address || fresh.contract !== review.balance.contract) throw new Error("The wallet changed. Review this transfer again.");
        if (BigInt(fresh.available) < BigInt(review.amount)) throw new Error("Your available balance changed. Review the amount again.");
        await walletTransferOperation(ctx.client, fresh, review.to, review.amount);
      },
      beforeBroadcast: async (transaction) => {
        if (!transaction.id) throw new Error("Could not save this transfer's transaction ID.");
        const pending = { ...review, transaction, createdAt: Date.now() };
        await store.save(pending);
        savedId = transaction.id;
        onPending?.(pending);
      },
    });
    await clearOwnRecord();
    return result.transaction.id ?? "";
  } catch (error) {
    // Unknown outcomes retain the exact signed request across reloads. Explicit refusals
    // and reverts can be reviewed again, but never clear another tab's existing record.
    if (savedId && !transferOutcomeUnknown(error)) await clearOwnRecord();
    throw error;
  }
}
export async function checkWalletTransfer(ctx: SubmitContext, pending: PendingWalletTransfer, store: TransferStore): Promise<"confirmed" | "reverted" | "pending"> {
  const client = ctx.client;
  if (await client.provider.getChainId() !== client.chainId) throw new Error("Wallet RPC chain mismatch.");
  const id = pending.transaction.id;
  if (!id) throw new Error("The saved transfer has no transaction ID.");
  // Provider.wait checks the containing block against the canonical head chain.
  let included;
  try { included = await client.provider.wait(id, "byTransactionId", 1500); }
  catch { return "pending"; }
  const blocks = await client.provider.getBlocksById([included.blockId], { returnBlock: false, returnReceipt: true });
  const receipt = blocks.block_items.find(b => b.block_id === included.blockId)?.receipt?.transaction_receipts?.find(r => r.id === id);
  if (!receipt || receipt.rpc_error) return "pending";
  await withAccountSubmission(ctx, async () => {
    if ((await store.load())?.transaction.id === id) await store.clear();
  });
  return receipt.reverted ? "reverted" : "confirmed";
}
