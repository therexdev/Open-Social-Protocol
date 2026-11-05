import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PHOTO_MAX_BYTES, ProtocolClient, toBase64url } from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../../testing/fixtures";
import { CollectionEditor, CollectionPage } from "./LibraryPages";
import { readCollection, saveCollection, type Collection } from "./libraryService";
import { PhotoReadError, preparePhoto } from "../composer/preparePhoto";
import type { GroupDraft } from "./groupDraft";

const mocks = vi.hoisted(() => ({ services: {} as any, session: undefined as any, vault: {} as any,
  submit: {} as any, saved: undefined as GroupDraft | undefined, music: vi.fn() }));
vi.mock("../../api/services", () => ({ useServices: () => mocks.services }));
vi.mock("../../vault/context", () => ({ useVault: (select: any) => select({ session: mocks.session }), useVaultStore: () => mocks.vault }));
vi.mock("../session", () => ({ useSubmitContext: () => mocks.submit }));
vi.mock("./libraryService", async original => ({ ...await original<typeof import("./libraryService")>(), readCollection: vi.fn(), saveCollection: vi.fn() }));
vi.mock("./groupDraft", async original => ({ ...await original<typeof import("./groupDraft")>(), groupDraftStore: async () => ({
  load: async () => mocks.saved, save: async (draft: GroupDraft) => { mocks.saved = structuredClone(draft); }, clear: async () => { mocks.saved = undefined; },
}) }));
vi.mock("../composer/preparePhoto", async original => ({ ...await original<typeof import("../composer/preparePhoto")>(), preparePhoto: vi.fn() }));
vi.mock("../../components/MediaPhoto", () => ({ MediaPhoto: ({ alt }: { alt: string }) => <img alt={alt}/> }));
vi.mock("./AccountPicker", () => ({ AccountPicker: () => null }));
vi.mock("../composer/PublishingProvider", () => ({ usePublishing: () => ({ posts: [] }) }));
vi.mock("../composer/PendingPosts", () => ({ PendingPosts: () => null }));
vi.mock("../composer/ComposerForm", () => ({ ComposerForm: () => <textarea aria-label="Group post draft"/> }));
vi.mock("../feed/FeedPage", () => ({ usePagedPosts: () => ({ items: [], loading: false }) }));
vi.mock("../music/GroupMusic", () => ({ GroupMusic: ({ groupId }: { groupId: string }) => { mocks.music(groupId); return <div>Group track gallery</div>; } }));

let root: Root, box: HTMLDivElement;
const id = toBase64url(new Uint8Array(32).fill(23));
const group: Collection = { id, name: "Our music club", record: { owner: "owner", kind: 2, audience: 2, revision: 1, members: ["member"], closed: false, envelope: new Uint8Array() } };
beforeEach(() => {
  vi.clearAllMocks(); mocks.saved = undefined;
  mocks.session = { identity: { account: "owner" } };
  mocks.services = { protocol: new ProtocolClient({ rpc: fakeProvider(), deployment: fixtureDeployment() }), indexer: {} };
  mocks.vault = { getState: () => ({ session: mocks.session, keepUnlocked: () => ({ renew() {}, release() {} }) }) };
  vi.mocked(readCollection).mockReset().mockResolvedValue(group);
  vi.mocked(saveCollection).mockReset().mockResolvedValue(undefined);
  vi.mocked(preparePhoto).mockReset().mockResolvedValue(Uint8Array.of(255, 216, 255, 217));
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
});
afterEach(async () => { await act(async () => root.unmount()); box.remove(); });
const show = async (node: React.ReactNode) => { await act(async () => root.render(<MemoryRouter initialEntries={[`/collections/${id}`]}><Routes><Route path="/collections/:id" element={node}/></Routes></MemoryRouter>)); };
const button = (text: string) => Array.from(box.querySelectorAll("button")).find(b => b.textContent === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
const edit = (key = "editor") => show(<CollectionEditor key={key} kind={2} previous={group} onSaved={() => undefined} onCancel={() => undefined}/>);
const save = async () => { await act(async () => box.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); };
async function select(input = box.querySelector<HTMLInputElement>('input[accept="image/*"]')!) {
  const file = new File(["pixels"], "banner.jpg", { type: "image/jpeg" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  return file;
}

it("opens on Posts, loads music only in its tab, and preserves a post draft across switches", async () => {
  await show(<CollectionPage/>);
  expect(box.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Posts");
  expect(mocks.music).not.toHaveBeenCalled();
  const draft = box.querySelector("textarea")!; draft.value = "Keep this group post";
  await click("Music");
  expect(box.querySelector<HTMLElement>('[role="tabpanel"][aria-label="Posts"]')!.hidden).toBe(true);
  expect(box.querySelector('[role="tabpanel"][aria-label="Music"]')?.textContent).toContain("Group track gallery");
  expect(mocks.music).toHaveBeenCalledWith(id);
  await click("Posts"); expect(box.querySelector("textarea")?.value).toBe("Keep this group post");
});

it("only exposes group settings to the owner and hides the content after lock", async () => {
  mocks.session = { identity: { account: "member" } };
  await show(<CollectionPage/>); expect(box.textContent).not.toContain("Manage group");
  mocks.session = { identity: { account: "owner" } };
  await show(<CollectionPage/>); await click("Manage group");
  expect(box.querySelector('input[accept="image/*"]')).toBeTruthy();
  mocks.session = undefined; await show(<CollectionPage/>);
  expect(box.querySelector('[role="tablist"]')).toBeNull();
  expect(box.querySelector('input[type="file"]')).toBeNull();
});

it("keeps albums separate from the group banner and music controls", async () => {
  await show(<CollectionEditor kind={1} previous={{ ...group, record: { ...group.record, kind: 1 } }} onSaved={() => undefined} onCancel={() => undefined}/>);
  expect(box.querySelector('input[type="file"]')).toBeNull();
  expect(box.textContent).toContain("Save album");
});

it("holds the selected mobile file until reading completes and prevents saving during preparation", async () => {
  await edit();
  const input = box.querySelector<HTMLInputElement>('input[accept="image/*"]')!;
  let selectedPath = "C:/fakepath/banner.jpg", finish!: (bytes: Uint8Array) => void;
  Object.defineProperty(input, "value", { configurable: true, get: () => selectedPath, set: value => { selectedPath = value; } });
  vi.mocked(preparePhoto).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await select(input);
  expect(selectedPath).toBe("C:/fakepath/banner.jpg"); expect(button("Save group").disabled).toBe(true);
  await save(); expect(saveCollection).not.toHaveBeenCalled();
  await act(async () => finish(Uint8Array.of(255, 216, 255, 217)));
  expect(selectedPath).toBe(""); expect(box.querySelector('img[alt="Group banner"]')).toBeTruthy();
  expect(preparePhoto).toHaveBeenCalledWith(expect.any(File), expect.any(AbortSignal), PHOTO_MAX_BYTES - 16);
});

it("offers the Files picker after an unreadable banner and performs no upload when selecting", async () => {
  await edit(); vi.mocked(preparePhoto).mockRejectedValueOnce(new PhotoReadError("NotReadableError"));
  await select();
  const files = box.querySelector<HTMLInputElement>('input[aria-label="Choose group banner from files"]')!;
  expect(files.hasAttribute("accept")).toBe(false);
  const open = vi.spyOn(files, "click"); await click("Choose from files"); expect(open).toHaveBeenCalledOnce();
  await select(files); expect(box.textContent).not.toContain("could not read");
  expect(box.querySelector('img[alt="Group banner"]')).toBeTruthy(); expect(saveCollection).not.toHaveBeenCalled();
});

it("persists the encrypted banner before saving and restores the exact upload after an interrupted edit", async () => {
  await edit(); await select();
  vi.mocked(saveCollection).mockImplementationOnce(async () => {
    expect(mocks.saved?.banner?.encryption).toBeDefined();
    expect(mocks.saved?.banner?.archiveBytes).toBeTruthy();
    throw Error("Connection interrupted");
  });
  await save(); const draft = mocks.saved!;
  await edit("restored"); expect(box.textContent).toContain("unfinished group edit was restored");
  await save();
  const retried = vi.mocked(saveCollection).mock.calls[1]![1].banner!;
  expect(retried.url).toBe(draft.banner!.url); expect(retried.encryption).toEqual(draft.banner!.encryption);
  expect(retried.archiveBytes).toBe(draft.banner!.archiveBytes); expect(mocks.saved).toBeUndefined();
});

it("can remove a selected banner and undo that change before submitting", async () => {
  await edit(); await select(); await click("Remove banner");
  expect(box.querySelector('img[alt="Group banner"]')).toBeNull();
  await save(); expect(vi.mocked(saveCollection).mock.calls[0]![1].banner).toBeNull();
  await click("Undo banner change"); await save(); expect(vi.mocked(saveCollection).mock.calls[1]![1].banner).toBeUndefined();
});
