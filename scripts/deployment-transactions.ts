import { Transaction, type ProviderInterface, type SignerInterface, type TransactionJson, type TransactionReceipt } from "koilib";
import { assertNotReverted, assertReceiptKnown } from "@osp/sdk";

type SubmitProvider = Pick<ProviderInterface, "sendTransaction" | "getAccountRc">;

export interface SubmitOptions {
  dryRun?: boolean;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  maxPendingRetries?: number;
}

/** Simulate without broadcasting, then re-sign a bounded RC limit before submitting. */
export async function submitMeasured(
  prepared: TransactionJson,
  provider: SubmitProvider,
  signers: SignerInterface[],
  options: SubmitOptions = {},
) {
  if (!prepared.header?.payer) throw new Error("deployment transaction has no payer");
  const transaction: TransactionJson = {
    id: prepared.id,
    header: { ...prepared.header },
    operations: prepared.operations,
    signatures: [],
  };
  const uniqueSigners = [...new Map(signers.map(s => [s.getAddress(), s])).values()];
  const sign = async () => {
    transaction.signatures = [];
    for (const signer of uniqueSigners) await signer.signTransaction(transaction);
  };
  const check = (receipt: TransactionReceipt) => {
    assertReceiptKnown(transaction, receipt);
    assertNotReverted(transaction, receipt);
    if (!/^\d+$/.test(String(receipt.rc_used ?? ""))) throw new Error("deployment simulation returned no measured RC usage");
  };
  await sign();
  const simulated = await provider.sendTransaction(transaction, false);
  check(simulated.receipt);
  if (options.dryRun) return simulated;

  const measured = BigInt(simulated.receipt.rc_used);
  const available = BigInt(await provider.getAccountRc(transaction.header!.payer!));
  if (measured > available || available === 0n) {
    throw new Error(`Insufficient Mana: simulation needs ${measured} RC; payer has ${available} RC. Fund the deployer or wait for regeneration.`);
  }
  // Ten percent headroom plus 0.0001 Mana for small serialization/cost changes.
  const buffered = (measured * 110n + 99n) / 100n + 10_000n;
  transaction.header!.rc_limit = (buffered < available ? buffered : available).toString();
  transaction.id = Transaction.computeTransactionId(transaction.header!);
  await sign();
  options.log?.(`measured ${measured} RC; transaction limit ${transaction.header!.rc_limit} RC`);

  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    let sent;
    try {
      sent = await provider.sendTransaction(transaction, true);
    } catch (error) {
      // A definite mempool refusal is safe to retry with the SAME signed transaction.
      // Never retry a timeout/unknown outcome or generate a new nonce here.
      let pending = false;
      try {
        const rpcError = JSON.parse(error instanceof Error ? error.message : String(error));
        pending = rpcError.code === 104 && /insufficient pending account resources/i.test(rpcError.error);
      } catch { /* Non-RPC failures have an unknown outcome and must not be retried. */ }
      if (!pending || attempt >= (options.maxPendingRetries ?? 60)) throw error;
      options.log?.("waiting for pending Mana reservations to clear (retry in 5 seconds)");
      await sleep(5_000);
      continue;
    }
    check(sent.receipt);
    return sent;
  }
}
