import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationsPage } from "./NotificationsPage";
import { getSeenCursor, setSeenCursor, useNotificationsBadge } from "./badge";

const test = vi.hoisted(() => ({ account: "alice", indexer: { configured: true, notifications: vi.fn() } }));
vi.mock("../../api/services", () => ({ useServices: () => ({ indexer: test.indexer }) }));
vi.mock("../../vault/context", () => ({ useVault: (pick: (s: object) => unknown) => pick({ account: test.account, status: "unlocked" }) }));
vi.mock("../profile/useProfileName", () => ({ useProfileName: () => "Friend" }));
let root: Root;
let container: HTMLDivElement;
const page = (...ids: string[]) => ({ items: ids.map(id => ({ id, actor: "friend", kind: "reaction", timestamp: String(Date.now()) })), nextCursor: ids.at(-1) });
function Badge() { const unread = useNotificationsBadge(1000); return <output data-badge>{unread}</output>; }
async function render(activity = true) {
  await act(async () => root.render(<MemoryRouter><Badge />{activity && <NotificationsPage />}</MemoryRouter>));
}
beforeEach(() => {
  localStorage.clear(); test.account = "alice"; test.indexer.notifications.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("automatically clears Activity badges when loaded, without a manual button, and keeps newer arrivals unread after leaving", async () => {
  vi.useFakeTimers(); test.indexer.notifications.mockResolvedValue(page("1", "2", "3"));
  await render(false);
  expect(container.querySelector("output")?.textContent).toBe("3");
  await render();
  expect(getSeenCursor("alice")).toBe("3");
  expect(container.querySelector("output")?.textContent).toBe("0");
  expect(container.textContent).not.toContain("Mark all as seen");
  await render(false);
  test.indexer.notifications.mockResolvedValue(page("4"));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.querySelector("output")?.textContent).toBe("1");
  expect(getSeenCursor("alice")).toBe("3");
});

it("does not resurrect a badge when an older unread request completes after Activity marked it seen", async () => {
  let finish!: (value: unknown) => void;
  test.indexer.notifications.mockImplementationOnce(() => new Promise(r => { finish = r; })).mockResolvedValue(page("8", "9"));
  await render();
  expect(getSeenCursor("alice")).toBe("9");
  await act(async () => finish(page("8", "9")));
  expect(container.querySelector("output")?.textContent).toBe("0");
});

it("does not mark failed loads or responses after leaving Activity as viewed", async () => {
  test.indexer.notifications.mockResolvedValueOnce(page("1")).mockRejectedValueOnce(new Error("offline"));
  await render();
  expect(getSeenCursor("alice")).toBeUndefined();
  expect(container.textContent).toContain("offline");
  await render(false);
  let finish!: (value: unknown) => void;
  test.indexer.notifications.mockImplementation(() => new Promise(r => { finish = r; }));
  await render(); await render(false);
  await act(async () => finish(page("20")));
  expect(getSeenCursor("alice")).toBeUndefined();
});

it("ignores the previous account's late Activity response and never moves a seen cursor backwards", async () => {
  let finish!: (value: unknown) => void;
  test.indexer.notifications.mockImplementation((account: string) => account === "alice" ? new Promise(r => { finish = r; }) : Promise.resolve(page("12")));
  await render(); test.account = "bob"; await render();
  await act(async () => finish(page("99")));
  expect(getSeenCursor("alice")).toBeUndefined(); expect(getSeenCursor("bob")).toBe("12");
  setSeenCursor("bob", "9007199254740993"); setSeenCursor("bob", "9007199254740992");
  expect(getSeenCursor("bob")).toBe("9007199254740993");
});

it("marks new Activity as read while visible, but waits until a hidden tab is viewed", async () => {
  vi.useFakeTimers(); test.indexer.notifications.mockResolvedValue(page("3")); await render();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  test.indexer.notifications.mockResolvedValue(page("4"));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(getSeenCursor("alice")).toBe("3");
  visibility.mockReturnValue("visible");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(getSeenCursor("alice")).toBe("4");
});
