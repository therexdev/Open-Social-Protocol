import { describe, expect, it, vi } from "vitest";
import { AUDIENCE, LIFECYCLE, encode, encryptContent, identityFromSeed, toBase64url, type ProtocolClient } from "@osp/sdk";
import { fakeBlockReceipt, fixtureDeployment } from "../testing/fixtures";
import { openPostRevision } from "./decrypt";
import type { PostVersionView, PostView } from "./indexer";
import { KeyStore } from "./keystore";

const deployment = fixtureDeployment();
const chainId = deployment.chainId;
const author = identityFromSeed(new Uint8Array(32).fill(1));
const reader = identityFromSeed(new Uint8Array(32).fill(2));
const id = new Uint8Array(32).fill(5);

function fixture(options: { private?: boolean; source?: string; reverted?: boolean; deleted?: boolean } = {}) {
  const audience = options.private ? AUDIENCE.CUSTOM : AUDIENCE.EVERYONE;
  const makeVersion = (number: number, text: string) => {
    const epochKey = new Uint8Array(32).fill(number);
    const audienceId = options.private ? new Uint8Array(32).fill(number + 5) : new Uint8Array();
    const envelope = encryptContent({
      content: { text },
      ...(options.private && { epochKey, aad: { chainId, author: author.account, postId: id, audience, audienceId, epoch: number, versionNumber: number } }),
    });
    return { ...envelope, epochKey, audienceId, epoch: number };
  };
  const original = makeVersion(1, "Original text");
  const latest = makeVersion(2, "Updated text");
  const version: PostVersionView = { versionNumber: 1, txId: "tx", blockHeight: "100", timestamp: "0", contentHash: toBase64url(original.contentHash) };
  const post = {
    author: author.account, postId: toBase64url(id), audience, audienceId: toBase64url(latest.audienceId),
    epoch: latest.epoch, versionNumber: 2, state: 0, contentHash: toBase64url(latest.contentHash), envelope: toBase64url(latest.bytes),
  } as PostView;
  const event = encode("publications.published_event", {
    author: post.author, post_id: id, audience, audience_id: original.audienceId,
    epoch: original.epoch, content_hash: original.contentHash, envelope: original.bytes, version_number: 1,
  });
  const receipt = fakeBlockReceipt("tx", [{ source: options.source ?? deployment.contracts.publications.address, name: "osp.publications.published", data: event }]);
  receipt.transaction_receipts![0]!.reverted = !!options.reverted;
  const getBlocks = vi.fn(async () => [{ block_id: "block", block_height: "100", receipt }]);
  const protocol = {
    deployment,
    provider: { getHeadInfo: async () => ({ head_topology: { id: "head", height: "105" } }), getBlocks },
    reads: { publications: { get_post: async () => ({ value: {
      author: post.author, audience, version_count: 2, state: options.deleted ? LIFECYCLE.DELETED : 0, latest_version: latest.contentHash,
    } }) } },
  } as unknown as ProtocolClient;
  return { post, original, latest, version, getBlocks, protocol };
}

describe("revision history", () => {
  it("reads the old envelope from its publication on the current fork", async () => {
    const { post, version, protocol, getBlocks } = fixture();
    expect(await openPostRevision(post, version, { chainId }, protocol)).toMatchObject({ status: "plain", content: { text: "Original text" } });
    expect(getBlocks).toHaveBeenCalledWith(100, 1, "head", { returnBlock: false, returnReceipt: true });
  });

  it("ignores forged index entries, foreign events and reverted receipts", async () => {
    for (const options of [{}, { source: deployment.contracts.identity.address }, { reverted: true }]) {
      const { post, version, protocol } = fixture(options);
      if (!Object.keys(options).length) version.contentHash = toBase64url(new Uint8Array(32).fill(9));
      expect(await openPostRevision(post, version, { chainId }, protocol)).toMatchObject({ status: "error" });
    }
  });

  it("gates private history with both the current and original revision keys", async () => {
    const { post, version, protocol, original, latest, getBlocks } = fixture({ private: true });
    const keys = new KeyStore();
    const context = { chainId, me: reader, keys };
    const remember = (item: typeof latest) => keys.put({ author: author.account, epoch: item.epoch, audienceId: item.audienceId }, item.epochKey);
    await remember(original);
    expect(await openPostRevision(post, version, context, protocol)).toMatchObject({ status: "no-key" });
    expect(getBlocks).not.toHaveBeenCalled();
    await remember(latest);
    await keys.forget({ author: author.account, epoch: original.epoch, audienceId: original.audienceId });
    expect(await openPostRevision(post, version, context, protocol)).toMatchObject({ status: "no-key" });
    await remember(original);
    expect(await openPostRevision(post, version, context, protocol)).toMatchObject({ status: "decrypted", content: { text: "Original text" } });
  });

  it("honors the current tombstone before fetching historical data", async () => {
    const { post, version, protocol, getBlocks } = fixture({ deleted: true });
    expect(await openPostRevision(post, version, { chainId }, protocol)).toMatchObject({ status: "tombstone" });
    expect(getBlocks).not.toHaveBeenCalled();
  });
});
