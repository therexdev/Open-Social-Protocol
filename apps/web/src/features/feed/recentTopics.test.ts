import { afterEach, expect, it, vi } from "vitest";
import { LONG_POST_FALLBACK, Signer, contentHash, encryptContent, storePostText, toBase64url } from "@osp/sdk";
import type { IndexerClient, PostView } from "../../api/indexer";
import { RecentTopics } from "./recentTopics";
import { extractHashtags } from "../../util/postText";
afterEach(() => vi.unstubAllGlobals());
function post(id: string, text: string, time: number, extra = {}): PostView {
  const envelope = encryptContent({ content: { version: 1, text, mime: "text/plain", ...extra } });
  return { postId: id, contentHash: toBase64url(contentHash(envelope.bytes)), envelope: toBase64url(envelope.bytes), createdAt: String(time), updatedAt: String(time), audience: 0, state: 0 } as PostView;
}
it("shows real recent tags, normalizes duplicates, and replaces edited and deleted topics instead of retaining seed tags", async () => {
  const feed = vi.fn().mockResolvedValue({ items: [post("old", "#Old #OLD #Café", 1), post("new", "#New", 2)], nextCursor: null });
  const store = new RecentTopics({ configured: true, feed } as unknown as IndexerClient);
  await store.refresh();
  expect(store.getSnapshot().topics[0]!.tag).toBe("new");
  expect(store.getSnapshot().topics.find(t => t.tag === "old")!.posts).toBe(1);
  expect(feed).toHaveBeenCalledWith({ scope: "public", limit: 30 });
  feed.mockResolvedValue({ items: [post("old", "#Updated", 3), { ...post("new", "#New", 2), state: 1 }], nextCursor: null });
  await store.refresh(true);
  expect(store.getSnapshot().topics.map(t => t.tag)).toEqual(["updated"]);
  feed.mockResolvedValue({ items: [], nextCursor: null }); await store.refresh(true);
  expect(store.getSnapshot().topics).toEqual([]);
});
it("does not advertise private/group posts, encrypted envelopes or content with an invalid fingerprint", async () => {
  const privateEnvelope = encryptContent({ content: { version: 1, text: "#Secret" }, epochKey: new Uint8Array(32).fill(1), aad: { chainId: toBase64url(new Uint8Array(32)), author: Signer.fromSeed("topic-private").getAddress(), audience: 1, epoch: 1, versionNumber: 1 } });
  const privateBytes = privateEnvelope.bytes;
  const feed = vi.fn().mockResolvedValue({ items: [
    post("good", "#Public", 1), { ...post("friend", "#Friend", 2), audience: 1 }, { ...post("group", "#Group", 3), collectionId: "group" },
    { ...post("bad", "#Bad", 4), contentHash: toBase64url(new Uint8Array(32)) },
    { ...post("pretend-public", "", 5), envelope: toBase64url(privateBytes), contentHash: toBase64url(contentHash(privateBytes)) },
  ] });
  const store = new RecentTopics({ configured: true, feed } as unknown as IndexerClient); await store.refresh();
  expect(store.getSnapshot().topics.map(t => t.tag)).toEqual(["public"]);
});
it("discovers hashtags at the end of long hosted text and reuses parsed fingerprints on refresh", async () => {
  const text = "A long public story. ".repeat(1000) + " #AtTheEnd";
  let bytes = new Uint8Array();
  const ref = await storePostText(text, false, async b => { bytes = new Uint8Array(b); return `https://media.example/osp/test/${toBase64url(contentHash(b))}`; });
  const fetch = vi.fn().mockImplementation(async () => new Response(new Uint8Array(bytes))); vi.stubGlobal("fetch", fetch);
  const feed = vi.fn().mockResolvedValue({ items: [post("hosted", LONG_POST_FALLBACK, 10, { text_ref: ref })] });
  const store = new RecentTopics({ configured: true, feed } as unknown as IndexerClient);
  await store.refresh(); await store.refresh(true);
  expect(store.getSnapshot().topics.map(t => t.tag)).toEqual(["attheend"]); expect(fetch).toHaveBeenCalledOnce();
});
it("ignores Markdown headings, code examples, explicit links and URL fragments", () => {
  expect(extractHashtags("## Heading\n\n#Actual **#BOLD** #Café\n\n`#Code`\n\n```\n#Block\n```\n\n[#Label](https://example.com) https://example.com/#fragment")).toEqual(["actual", "bold", "café"]);
});
