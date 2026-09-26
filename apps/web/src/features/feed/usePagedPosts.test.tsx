import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PostView } from "../../api/indexer";
import { usePagedPosts } from "./FeedPage";

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.useRealTimers(); });

it.each(["online", "timer"])("recovers a failed initial post load on %s without navigation", async trigger => {
  vi.useFakeTimers();
  const load = vi.fn().mockRejectedValueOnce(new Error("temporary outage")).mockResolvedValue({ items: [{ postId: "recovered-post" } as PostView], nextCursor: null });
  function View() {
    const posts = usePagedPosts(load, [load]);
    return <div>{posts.error ?? posts.items.map(p => p.postId).join(",")}</div>;
  }
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root!.render(<View />));
  expect(container.textContent).toBe("temporary outage");
  await act(async () => {
    if (trigger === "online") window.dispatchEvent(new Event("online"));
    else await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(container.textContent).toBe("recovered-post");
  expect(load).toHaveBeenCalledTimes(2);
});
