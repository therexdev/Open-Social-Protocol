import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PendingRewards } from "./PendingRewards";

const indexer = vi.hoisted(() => ({ pendingRewards: vi.fn() }));
vi.mock("../../api/services", () => ({ useServices: () => ({ indexer }) }));

const entry = (postId: string, block: string) => ({
  postId, economy: { block, epoch: { end_block: "10" }, reward: { epoch: "1", up: "2", down: "0", settled: false } },
});
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  indexer.pendingRewards.mockReset();
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); });
async function render() {
  await act(async () => root.render(<MemoryRouter><PendingRewards account="alice" automaticSettlement/></MemoryRouter>));
}
it("keeps open and closed rewards pending until the indexer sees settlement", async () => {
  indexer.pendingRewards.mockResolvedValue({ items: [entry("post", "9")], nextCursor: null });
  await render();
  expect(host.textContent).toContain("Voting closes at block 10");
  expect(host.querySelector("button")).toBeNull();
  indexer.pendingRewards.mockResolvedValue({ items: [entry("post", "10")], nextCursor: null });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(host.textContent).toContain("Awaiting automatic settlement");
  indexer.pendingRewards.mockResolvedValue({ items: [], nextCursor: null });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(host.textContent).toContain("No pending post rewards");
});
it("keeps additional pages visible across refreshes and reports read failures", async () => {
  indexer.pendingRewards.mockImplementation(async (_account: string, cursor?: string) =>
    cursor ? { items: [entry("two", "20")], nextCursor: null } : { items: [entry("one", "20")], nextCursor: "cursor" });
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect([...host.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual(["/post/one", "/post/two"]);
  indexer.pendingRewards.mockRejectedValue(new Error("Indexer offline"));
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Indexer offline");
  expect(host.querySelectorAll("a")).toHaveLength(2);
});
