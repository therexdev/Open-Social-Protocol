import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AUDIENCE } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
import { HashtagPage } from "./HashtagPage";

const state = vi.hoisted(() => ({ vault: { account: "alice", status: "unlocked" }, indexer: { configured: true, feed: vi.fn() } }));
vi.mock("../../api/services", () => ({ useServices: () => ({ indexer: state.indexer, resolved: { chainId: "test" } }) }));
vi.mock("../../vault/context", () => ({ useVault: (pick: (state: object) => unknown) => pick(state.vault) }));
vi.mock("../composer/PublishingProvider", () => ({ usePublishing: () => ({ posts: [] }) }));
vi.mock("../composer/PendingPosts", () => ({ PendingPosts: () => null, indexedDraft: () => false }));
vi.mock("./usePostContent", () => ({ usePostContent: (post: PostView) => post.envelope === "LOCKED"
  ? { status: "no-key" } : { status: post.audience === 0 ? "plain" : "decrypted", content: { text: post.envelope } } }));
vi.mock("./PostCard", () => ({ OpenedPostCard: ({ post }: { post: PostView }) => <article data-id={post.postId}>{post.envelope}</article> }));

let root: Root, container: HTMLDivElement;
const post = (id: string, text: string, audience: number = AUDIENCE.EVERYONE) => ({ postId: id, contentHash: id, audience, envelope: text, versionNumber: 1, state: 0, createdAt: "1" }) as PostView;
const page = (items: PostView[], nextCursor: string | null = null) => ({ items, nextCursor });
const render = async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={["/tags/Topic"]}><Routes><Route path="/tags/:tag" element={<HashtagPage/>}/></Routes></MemoryRouter>));
};
beforeEach(() => {
  state.vault = { account: "alice", status: "unlocked" }; state.indexer.feed.mockReset();
  container = document.createElement("div"); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it("combines and deduplicates public/friend matches, excludes unreadable posts, and searches older pages", async () => {
  const shared = post("shared", "Public #TOPIC");
  state.indexer.feed.mockImplementation(async ({ scope, cursor }) => cursor ? page([post("older", "Older #topic")]) : scope === "public"
    ? page([shared, post("fragment", "https://example.org/#topic")], "older-page")
    : page([shared, post("friend", "Private #Topic", AUDIENCE.FRIENDS), post("locked", "LOCKED", AUDIENCE.FRIENDS), post("custom", "Custom #topic", 2)]));
  await render();
  expect(container.querySelectorAll("article")).toHaveLength(2);
  expect(container.textContent).toContain("Private #Topic");
  expect(container.textContent).not.toContain("LOCKED");
  expect(container.textContent).not.toContain("Custom #topic");
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Search older posts")!.click());
  expect(container.querySelectorAll("article")).toHaveLength(3);
  expect(state.indexer.feed).toHaveBeenCalledWith(expect.objectContaining({ cursor: "older-page", scope: "public", viewer: "alice" }));
  expect(state.indexer.feed.mock.calls.every(([query]) => !("tag" in query))).toBe(true);
});
it("removes private results immediately on lock and never requests the friends feed as a guest", async () => {
  state.indexer.feed.mockImplementation(async ({ scope }) => page(scope === "friends" ? [post("friend", "Secret #topic", AUDIENCE.FRIENDS)] : []));
  await render(); expect(container.textContent).toContain("Secret #topic");
  state.vault = { account: "alice", status: "locked" }; state.indexer.feed.mockClear();
  await render();
  expect(container.textContent).not.toContain("Secret #topic");
  expect(state.indexer.feed.mock.calls.every(([query]) => query.scope === "public" && query.viewer === undefined)).toBe(true);
  expect(container.textContent).toContain("Unlock your account");
});
it("keeps older-page discovery available when the first page has no matches", async () => {
  state.indexer.feed.mockResolvedValue(page([post("other", "#Different")], "next"));
  await render();
  expect(container.textContent).toContain("No matches in these recent posts");
  expect([...container.querySelectorAll("button")].some(button => button.textContent === "Search older posts" && !button.disabled)).toBe(true);
});
