import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClipPlayer } from "./ClipPlayer";
import { loadClip } from "./clipArchive";
import type { MediaAttachment } from "../composer/publish";
const mocks = vi.hoisted(() => ({ session: undefined as any, protocol: {}, visible: undefined as ((v: boolean) => void) | undefined }));
vi.mock("../../api/services", () => ({ useServices: () => ({ protocol: mocks.protocol }) }));
vi.mock("../../vault/context", () => ({ useVault: (select: any) => select({ session: mocks.session }) }));
vi.mock("./clipArchive", () => ({ loadClip: vi.fn() }));
vi.mock("../../components/MediaPhoto", () => ({ MediaPhoto: ({ alt }: { alt: string }) => <img alt={alt}/> }));
const media: MediaAttachment = { url: "osp-clip://contract/video", mime: "video/mp4", size: 100, contentHash: new Uint8Array(32),
  videoPoster: { url: "osp-photo://contract/poster", contentHash: "hash", mime: "image/jpeg", size: 20 } };
let box: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks(); mocks.session = undefined;
  vi.mocked(loadClip).mockResolvedValue(new Uint8Array([1,2,3]));
  vi.stubGlobal("URL", class extends URL { static override createObjectURL = vi.fn(() => "blob:clip"); static override revokeObjectURL = vi.fn(); });
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: any) { mocks.visible = v => callback([{ isIntersecting: v }]); } observe() {} disconnect() {} });
  box = document.createElement("div"); root = createRoot(box);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const show = async (value = media) => { await act(async () => root.render(<ClipPlayer media={value}/>)); };
const visible = async () => { await act(async () => mocks.visible?.(true)); };
it("shows a thumbnail near the viewport and fetches the video only when played", async () => {
  await show(); expect(box.querySelector("img")).toBeNull(); expect(loadClip).not.toHaveBeenCalled();
  await visible(); expect(box.querySelector('img[alt="Video preview"]')).toBeTruthy(); expect(loadClip).not.toHaveBeenCalled();
  await act(async () => box.querySelector<HTMLButtonElement>('button[aria-label="Play video"]')!.click());
  expect(loadClip).toHaveBeenCalledOnce(); expect(box.querySelector("video")?.autoplay).toBe(true);
});
it("loads older videos into a paused inline player without autoplay", async () => {
  await show({ ...media, videoPoster: undefined }); await visible();
  expect(loadClip).toHaveBeenCalledOnce(); const video = box.querySelector("video")!;
  expect(video).toBeTruthy(); expect(video.autoplay).toBe(false); expect(video.controls).toBe(true);
});
it("never loads private previews while locked and revokes loaded video URLs on lock", async () => {
  const privateMedia = { ...media, encryption: { key: "secret", nonce: "nonce" } };
  await show(privateMedia); await visible(); expect(box.querySelector("img")).toBeNull(); expect(loadClip).not.toHaveBeenCalled();
  mocks.session = { identity: { account: "owner" } }; await show(privateMedia); await visible();
  await act(async () => box.querySelector<HTMLButtonElement>('button[aria-label="Play video"]')!.click());
  expect(box.querySelector("video")).toBeTruthy();
  mocks.session = undefined; await show(privateMedia);
  expect(box.querySelector("video")).toBeNull(); expect(box.querySelector("img")).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip");
});
it("cancels an in-flight passive load when the video leaves the viewport", async () => {
  let resolve!: (bytes: Uint8Array) => void;
  vi.mocked(loadClip).mockImplementation(() => new Promise(r => { resolve = r; }));
  await show({ ...media, videoPoster: undefined }); await visible();
  const signal = vi.mocked(loadClip).mock.calls[0]![2]!;
  await act(async () => mocks.visible?.(false)); expect(signal.aborted).toBe(true);
  await act(async () => resolve(new Uint8Array([1]))); expect(box.querySelector("video")).toBeNull();
});
