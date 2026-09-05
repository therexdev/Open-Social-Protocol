/**
 * Where did a sealed key the indexer serves come from? The chain decides (spec section 1).
 *
 * A sealed key is trusted only when the transaction the indexer names is in a block whose
 * receipt carries an `osp.publications.keys_distributed` event, emitted by the publications
 * contract, for the same (author, audience_id, epoch), whose key package set contains exactly
 * this sealed key. The contract emits that event only after checking the author's authority
 * (owner or an authorized device), so a verified key was sealed by the author, and the package
 * set names every account that received a copy.
 */
import { addressToString, bytesEqual, decode, decodeBlockEvents, isEvent, parseKeyPackageSet, type BlockLike, type Deployment, type ProviderInterface, type SealedKey } from "@osp/sdk";
import { bytesOf } from "../util/bytes";
import type { SealedKeyView } from "./indexer";
import type { EpochKeyRef, KeyProvenance, KeyVerifier } from "./keystore";

export interface ProvenanceChain {
  provider: Pick<ProviderInterface, "getTransactionsById" | "getBlocksById">;
  deployment: Deployment;
}

export function chainKeyVerifier(chain: ProvenanceChain): KeyVerifier {
  return (item, ref) => verifySealedKeyProvenance(chain, item, ref);
}

function sameSealedKey(a: SealedKey, b: SealedKey): boolean {
  return (
    bytesEqual(a.recipient, b.recipient) &&
    (a.recipient_key_version || 0) === (b.recipient_key_version || 0) &&
    bytesEqual(a.ephemeral_public_key, b.ephemeral_public_key) &&
    bytesEqual(a.nonce, b.nonce) &&
    bytesEqual(a.ciphertext, b.ciphertext)
  );
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function verifySealedKeyProvenance(chain: ProvenanceChain, item: SealedKeyView, ref: EpochKeyRef): Promise<KeyProvenance> {
  if (!item.txId) return { status: "rejected", reason: "the indexer named no transaction for this key" };
  let sealed: SealedKey;
  try {
    sealed = decode<SealedKey>("osp.envelope.sealed_key", bytesOf(item.sealedKey));
  } catch {
    return { status: "rejected", reason: "malformed sealed key" };
  }

  let blockIds: string[];
  try {
    const { transactions } = await chain.provider.getTransactionsById([item.txId]);
    blockIds = (transactions ?? []).find((t) => t.transaction?.id === item.txId)?.containing_blocks ?? [];
  } catch (error) {
    return { status: "unavailable", reason: reason(error) };
  }
  if (blockIds.length === 0) return { status: "rejected", reason: "the transaction is not on chain" };

  let blocks: BlockLike[];
  try {
    const { block_items } = await chain.provider.getBlocksById(blockIds, { returnBlock: false, returnReceipt: true });
    blocks = (block_items ?? []).map((b) => ({ block_id: b.block_id, block_height: b.block_height, receipt: b.receipt as BlockLike["receipt"] }));
  } catch (error) {
    return { status: "unavailable", reason: reason(error) };
  }

  const recipients = new Set<string>();
  let found = false;
  for (const block of blocks) {
    for (const event of decodeBlockEvents(block, chain.deployment)) {
      if (!isEvent(event, "osp.publications.keys_distributed") || event.txId !== item.txId) continue;
      const data = event.data;
      if (data.author !== ref.author || data.epoch !== ref.epoch || !bytesEqual(data.audience_id, ref.audienceId)) continue;
      let set;
      try {
        set = parseKeyPackageSet(data.packages);
      } catch {
        continue;
      }
      if (!set.keys.some((k) => sameSealedKey(k, sealed))) continue;
      found = true;
      for (const k of set.keys) recipients.add(addressToString(k.recipient));
    }
  }
  return found ? { status: "verified", recipients: [...recipients] } : { status: "rejected", reason: "no key distribution by the author in that transaction contains this key" };
}
