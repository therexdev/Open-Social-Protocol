// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { ProtocolClient, identityFromSeed, TransactionOutcomeUnknownError, SponsorError, type TransactionJson } from "@osp/sdk";
import { fakeProvider, fakeReceipt, fixtureDeployment } from "../../testing/fixtures";
import { ActionError, submitAction, type SubmitContext } from "../../tx/submit";
import { checkWalletTransfer, sendWalletTransfer, type PendingWalletTransfer, type TransferStore, type WalletReview } from "./walletService";
vi.mock("../../tx/submit", async original => ({ ...await original<typeof import("../../tx/submit")>(), submitAction: vi.fn() }));
const me = identityFromSeed(new Uint8Array(32).fill(4)), other = identityFromSeed(new Uint8Array(32).fill(5));
let client: ProtocolClient, ctx: SubmitContext, review: WalletReview, store: TransferStore, pending: PendingWalletTransfer | undefined;
const transaction = { id: "0x1220" + "1".repeat(64), header: {}, operations: [], signatures: [] } as TransactionJson;
beforeEach(() => {
  vi.restoreAllMocks(); pending = undefined;
  client = new ProtocolClient({ deployment: fixtureDeployment(), rpc: fakeProvider() });
  ctx = { client, signer: me.signer, payment: "self-only" };
  review = { balance: { token: "osat", address: me.account, contract: client.deployment.contracts.token.address, symbol: "OSAT", decimals: 0, balance: "100", available: "7", locked: "93" }, account: me.account, to: other.account, amount: "7", all: true };
  store = { load: vi.fn(async () => pending), save: vi.fn(async p => { pending = p; }), clear: vi.fn(async () => { pending = undefined; }) };
  vi.spyOn(client.reads.token, "get_account").mockResolvedValue({ value: { balance: "100", transferable: "7", resource_version: 2 } } as never);
  vi.spyOn(client.reads.identity, "get_identity").mockResolvedValue({ value: { account: other.account } } as never);
  vi.mocked(submitAction).mockImplementation(async (context, _ops, options) => {
    expect(context.payment).toBe("sponsor-only");
    await options.beforeSubmit?.(); await options.beforeBroadcast?.(transaction);
    return { transaction, sponsored: true } as never;
  });
});
it("uses sponsor-only payment, persists before submission and clears after confirmation", async () => {
  expect(await sendWalletTransfer(ctx, review, store)).toBe(transaction.id);
  expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ transaction, amount: "7" }));
  expect(pending).toBeUndefined();
});
it("requires a fresh review when available tokens decrease while another action is queued", async () => {
  vi.mocked(client.reads.token.get_account).mockResolvedValue({ value: { balance: "100", transferable: "6", resource_version: 2 } } as never);
  await expect(sendWalletTransfer(ctx, review, store)).rejects.toThrow("balance changed");
  expect(store.save).not.toHaveBeenCalled();
});
it("never increases the approved amount as tokens recharge after a Send all review", async () => {
  vi.mocked(client.reads.token.get_account).mockResolvedValue({ value: { balance: "100", transferable: "8", resource_version: 2 } } as never);
  await sendWalletTransfer(ctx, review, store);
  expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ amount: "7" }));
});
it("keeps unknown outcomes across reloads and blocks another transfer", async () => {
  vi.mocked(submitAction).mockImplementationOnce(async (_ctx, _ops, options) => {
    await options.beforeSubmit?.(); await options.beforeBroadcast?.(transaction);
    throw new ActionError("Pending", new TransactionOutcomeUnknownError(transaction, fakeReceipt(transaction, { rpc_error: "timeout" })));
  });
  await expect(sendWalletTransfer(ctx, review, store)).rejects.toThrow("Pending");
  expect(pending?.transaction.id).toBe(transaction.id);
  await expect(sendWalletTransfer(ctx, review, store)).rejects.toThrow("pending wallet transfer");
  expect(pending?.transaction.id).toBe(transaction.id);
});
it("allows review again after an explicit sponsor refusal", async () => {
  vi.mocked(submitAction).mockImplementationOnce(async (_ctx, _ops, options) => {
    await options.beforeSubmit?.(); await options.beforeBroadcast?.(transaction);
    throw new ActionError("Refused", new SponsorError("quota_exceeded", "daily limit"));
  });
  await expect(sendWalletTransfer(ctx, review, store)).rejects.toThrow("Refused");
  expect(pending).toBeUndefined();
});
it("never submits when the recovery record cannot be saved", async () => {
  vi.mocked(store.save).mockRejectedValue(new Error("Storage unavailable"));
  await expect(sendWalletTransfer(ctx, review, store)).rejects.toThrow("Storage unavailable");
});
it("clears a pending transfer only after its canonical block receipt is available", async () => {
  pending = { ...review, transaction, createdAt: Date.now() };
  client.provider.wait = vi.fn(async () => { throw new Error("not mined"); });
  expect(await checkWalletTransfer(ctx, pending, store)).toBe("pending");
  expect(store.clear).not.toHaveBeenCalled();
  client.provider.wait = vi.fn(async () => ({ blockId: "block", blockNumber: 101 }));
  client.provider.getBlocksById = vi.fn(async () => ({ block_items: [{ block_id: "block", receipt: { transaction_receipts: [{ id: transaction.id, reverted: false }] } }] })) as never;
  expect(await checkWalletTransfer(ctx, pending, store)).toBe("confirmed");
  expect(pending).toBeUndefined();
});
