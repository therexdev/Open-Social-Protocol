import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PostPage } from "./post/PostPage";
import { useGraph } from "./friends/RelationshipActions";
import { usePagedPosts } from "./feed/FeedPage";
import type { PostView } from "../api/indexer";

const api = vi.hoisted(() => ({ indexer: { configured: true, post: vi.fn(), replies: vi.fn(), graph: vi.fn() } }));
vi.mock("../api/services", () => ({ useServices: () => api }));
vi.mock("../vault/context", () => ({ useVault: (pick: (s: object) => unknown) => pick({ status: "locked" }) }));
vi.mock("./session", () => ({ useCanAct: () => ({ ok: false }), useSubmitContext: () => undefined, useSession: () => undefined }));
vi.mock("./feed/PostCard", () => ({ PostCard: ({ post }: { post: PostView }) => <div>Loaded {post.postId}</div> }));
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container?.remove(); vi.useRealTimers(); vi.clearAllMocks(); });
const mount = async (node: React.ReactNode) => {
  container = document.createElement("div"); root = createRoot(container);
  await act(async () => { root!.render(node); });
};

describe("product loading and account changes", () => {
  it("turns a newly published link into the post automatically when indexing catches up", async () => {
    vi.useFakeTimers();
    api.indexer.post.mockResolvedValue(undefined);
    api.indexer.replies.mockResolvedValue({ items: [], nextCursor: null });
    await mount(<MemoryRouter initialEntries={["/post/new-post"]}><Routes><Route path="/post/:postId" element={<PostPage />} /></Routes></MemoryRouter>);
    expect(container.textContent).toContain("Checking automatically");
    expect(container.querySelector(".notice-error")).toBeNull();
    api.indexer.post.mockResolvedValue({ postId: "new-post", versions: [], state: 0, author: "author" });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(container.textContent).toContain("Loaded new-post");
    expect(container.textContent).not.toContain("Checking automatically");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not replace the new account's graph with a late response for the previous account", async () => {
    let finish!: (value: object) => void;
    api.indexer.graph.mockImplementation((account: string) => account === "old" ? new Promise(r => { finish = r; }) : Promise.resolve({ account, friends: [] }));
    function Graph({ account }: { account: string }) { return <div>{useGraph(account).graph?.account}</div>; }
    await mount(<Graph account="old" />);
    await act(async () => root!.render(<Graph account="new" />));
    await act(async () => finish({ account: "old", friends: [] }));
    expect(container.textContent).toBe("new");
  });

  it("does not restore a previous account's feed after switching accounts", async () => {
    let finish!: (value: { items: PostView[]; nextCursor: null }) => void;
    const old = new Promise<{ items: PostView[]; nextCursor: null }>(r => { finish = r; });
    function Feed({ account }: { account: string }) {
      const feed = usePagedPosts(() => account === "old" ? old : Promise.resolve({ items: [{ postId: "new-account-post" } as PostView], nextCursor: null }), [account]);
      return <div>{feed.items.map(p => p.postId).join(",")}</div>;
    }
    await mount(<Feed account="old" />);
    await act(async () => root!.render(<Feed account="new" />));
    await act(async () => finish({ items: [{ postId: "old-account-post" } as PostView], nextCursor: null }));
    expect(container.textContent).toBe("new-account-post");
  });
});
