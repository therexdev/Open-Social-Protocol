import { bytesEqual, decodeReceiptEvents, isEvent, toBase64url, type ProtocolClient } from "@osp/sdk";
import { bytesOf } from "../util/bytes";
import type { PostVersionView, PostView } from "./indexer";

/** The indexer supplies the position. Only a successful publication on the current fork supplies the content. */
export async function readPostRevision(
  chain: Pick<ProtocolClient, "provider" | "deployment">,
  post: PostView,
  version: PostVersionView,
): Promise<PostView> {
  const height = Number(version.blockHeight);
  if (!Number.isSafeInteger(height) || height < 1 || version.versionNumber < 1 || version.versionNumber >= post.versionNumber) {
    throw new Error("Invalid revision position.");
  }
  const head = (await chain.provider.getHeadInfo()).head_topology;
  if (height > Number(head.height)) throw new Error("The revision is ahead of the current chain.");
  const blocks = await chain.provider.getBlocks(height, 1, head.id, { returnBlock: false, returnReceipt: true });
  const block = blocks.find(value => Number(value.block_height) === height);
  const receipt = block?.receipt?.transaction_receipts?.find(value => value.id === version.txId && !value.reverted);
  if (receipt) {
    for (const event of decodeReceiptEvents(receipt, chain.deployment)) {
      if (!isEvent(event, "osp.publications.published")) continue;
      const data = event.data;
      if (data.author !== post.author || data.audience !== post.audience || data.version_number !== version.versionNumber ||
          !bytesEqual(data.post_id, bytesOf(post.postId)) || !bytesEqual(data.content_hash, bytesOf(version.contentHash))) continue;
      return {
        ...post,
        versionNumber: data.version_number,
        contentHash: toBase64url(data.content_hash),
        audienceId: toBase64url(data.audience_id),
        epoch: data.epoch,
        envelope: toBase64url(data.envelope),
      };
    }
  }
  throw new Error("This revision could not be verified against its publication on the current chain.");
}
