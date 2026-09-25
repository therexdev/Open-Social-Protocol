import type { Provider } from "koilib";
import { sha256Hex, type DeployedContract } from "./common.ts";

/** Verify the canonical upload receipt and bytes, using RPCs supported by the public testnet. */
export async function verifyUpload(provider: Pick<Provider, "getBlocks" | "call">, entry: DeployedContract): Promise<boolean> {
  const height = Number(entry.block);
  if (!Number.isSafeInteger(height) || height < 1) return false;
  const [block] = await provider.getBlocks(height, 1);
  if (!block || block.block_height !== entry.block) return false;
  const tx = block.block.transactions?.find(t => t.id === entry.txId);
  const receipt = block.receipt?.transaction_receipts?.find(r => r.id === entry.txId);
  if (!tx || !receipt || receipt.reverted || receipt.rpc_error) return false;
  const upload = tx.operations?.find(o => o.upload_contract?.contract_id === entry.address)?.upload_contract;
  if (!upload?.bytecode || !upload.abi) return false;
  if (sha256Hex(Buffer.from(upload.bytecode, "base64url")) !== entry.wasmSha256 ||
      sha256Hex(Buffer.from(upload.abi)) !== entry.abiSha256) return false;
  const current = await provider.call<{ meta?: { abi?: string } }>("contract_meta_store.get_contract_meta", { contract_id: entry.address });
  return Boolean(current.meta?.abi && sha256Hex(Buffer.from(current.meta.abi)) === entry.abiSha256);
}
