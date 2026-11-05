import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ProfilePage } from "./ProfilePage";
const self = "1EiR6tc8jtVK6boR5w1chjq17XEXXHiNk4";
const peer = "1WhPkYjyS1ChEKmbxNAyFUHLuRVQCjNMF";
const mocks = vi.hoisted(() => ({ blocked: [] as string[] }));
vi.mock("../../api/services", () => ({ useServices: () => ({ indexer: { configured: true } }) }));
vi.mock("../../vault/context", () => ({ useVault: (selector: any) => selector({ account: "1EiR6tc8jtVK6boR5w1chjq17XEXXHiNk4", status: "unlocked" }) }));
vi.mock("../music/MusicSection", () => ({ MusicSection: ({ owner }: { owner: string }) => <div data-music-owner={owner}>Profile music</div> }));
vi.mock("../session", () => ({ useCanAct: () => ({ ok: true }), useSubmitContext: () => undefined }));
vi.mock("./useProfileName", () => ({ useProfileInfo: () => ({ displayName: "Jim", registered: true }) }));
vi.mock("../feed/FeedPage", () => ({ usePagedPosts: () => ({ items: [], loading: false }) }));
vi.mock("../friends/RelationshipActions", () => ({ RelationshipActions: () => null, useGraph: () => ({ graph: { blocked: mocks.blocked }, refresh: vi.fn() }) }));
let root: Root, box: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); box?.remove(); mocks.blocked = []; vi.unstubAllGlobals(); });
async function mount(account: string) {
  box = document.createElement("div"); root = createRoot(box);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/u/${account}`]}><Routes><Route path="/u/:account" element={<ProfilePage />} /></Routes></MemoryRouter>));
}
it("links another profile directly to its message recipient", async () => {
  await mount(peer);
  expect(box.querySelector(`a[href="/messages?to=${peer}"]`)?.textContent).toBe("Message");
});
it("does not offer messaging your own profile", async () => {
  await mount(self); expect(box.querySelector('a[href^="/messages"]')).toBeNull();
});
it("does not offer a message shortcut for a blocked profile", async () => {
  mocks.blocked = [peer]; await mount(peer); expect(box.querySelector('a[href^="/messages"]')).toBeNull();
});

it("opens Music for the selected personal profile", async () => {
  await mount(peer);
  const tab = [...box.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(x => x.textContent === "Music");
  expect(tab).toBeDefined();
  await act(async () => tab!.click());
  expect(box.querySelector("[data-music-owner]")?.getAttribute("data-music-owner")).toBe(peer);
  expect(tab!.getAttribute("aria-selected")).toBe("true");
});
it("uses the requested mobile order and keeps the existing desktop order", async () => {
  let changed!: () => void;
  const query = { matches: true, addEventListener: (_: string, fn: () => void) => { changed = fn; }, removeEventListener() {} };
  vi.stubGlobal("matchMedia", () => query);
  await mount(peer);
  const labels = () => [...box.querySelectorAll('[role="tab"]')].map(tab => tab.textContent);
  expect(labels()).toEqual(["Posts", "Groups", "About", "Photos", "Music", "Videos"]);
  query.matches = false; await act(async () => changed());
  expect(labels()).toEqual(["Posts", "Photos", "Music", "Videos", "Groups", "About"]);
});
