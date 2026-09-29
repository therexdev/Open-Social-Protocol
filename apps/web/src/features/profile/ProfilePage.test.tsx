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
vi.mock("../session", () => ({ useCanAct: () => ({ ok: true }), useSubmitContext: () => undefined }));
vi.mock("./useProfileName", () => ({ useProfileInfo: () => ({ displayName: "Jim", registered: true }) }));
vi.mock("../feed/FeedPage", () => ({ usePagedPosts: () => ({ items: [], loading: false }) }));
vi.mock("../friends/RelationshipActions", () => ({ RelationshipActions: () => null, useGraph: () => ({ graph: { blocked: mocks.blocked }, refresh: vi.fn() }) }));
let root: Root, box: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); box?.remove(); mocks.blocked = []; });
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
