import { describe, expect, it } from "vitest";
import { contentHash, encryptContent, identityFromSeed, toBase64url, type ProtocolClient } from "@osp/sdk";
import type { PostView } from "../shared/indexer";
import { openPost } from "./decrypt";

const author = identityFromSeed(new Uint8Array(32).fill(7)).account;
const bytes = encryptContent({ content: { text: "verified post" } }).bytes;
const hash = contentHash(bytes);
const post: PostView = {
  postId: toBase64url(new Uint8Array(32).fill(1)), author, sequence: "1", versionNumber: 1,
  contentHash: toBase64url(hash), previousVersion: "", audience: 0, audienceId: "", epoch: 0,
  envelope: toBase64url(bytes), media: [], replyTo: "", state: 0, stateReason: "", replacementId: "",
  createdAt: "1", updatedAt: "1", txId: "", blockHeight: "1", reactions: { total: 0, byType: {} }, replyCount: 0, versions: [], labels: [],
};
const chain = (overrides = {}) => ({ reads: { publications: { get_post: async () => ({ value: {
  author, audience: 0, state: 0, version_count: 1, latest_version: hash, ...overrides,
} }) } } }) as unknown as Pick<ProtocolClient, "reads">;

describe("verified extension feed", () => {
  it("opens published content and rejects altered envelopes and author claims", async () => {
    expect((await openPost(post, { chainId: "test", chain: chain() })).content?.text).toBe("verified post");
    const replacement = encryptContent({ content: { text: "substituted" } }).bytes;
    expect((await openPost({ ...post, envelope: toBase64url(replacement) }, { chainId: "test", chain: chain() })).status).toBe("error");
    expect((await openPost({ ...post, author: "forged" }, { chainId: "test", chain: chain() })).status).toBe("error");
  });

  it("honors chain deletion even when the indexer still returns content", async () => {
    expect((await openPost(post, { chainId: "test", chain: chain({ state: 2 }) })).status).toBe("tombstone");
  });
});
