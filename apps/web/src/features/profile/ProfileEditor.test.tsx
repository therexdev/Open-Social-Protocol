import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { contentHash, PHOTO_MAX_BYTES, photoLocation, profilePhotoId, toBase64url } from "@osp/sdk";
import { ProfileEditor } from "./ProfileEditor";
import { buildProfileDocument, parseProfileUri } from "../../api/profiles";
import type { ProfileView } from "../../api/indexer";
import { PhotoReadError, preparePhoto } from "../composer/preparePhoto";
import { archivePhoto } from "../composer/archivePhoto";
import { submitAction } from "../../tx/submit";

const mocks = vi.hoisted(() => ({ ctx: {} as any, session: {} as any }));
vi.mock("../session", () => ({ useSubmitContext: () => mocks.ctx }));
vi.mock("../../vault/context", () => ({ useVaultStore: () => ({ getState: () => ({ session: mocks.session }) }) }));
vi.mock("../composer/preparePhoto", async importOriginal => ({
  ...await importOriginal<typeof import("../composer/preparePhoto")>(),
  preparePhoto: vi.fn(),
}));
vi.mock("../composer/archivePhoto", () => ({ archivePhoto: vi.fn() }));
vi.mock("../../tx/submit", () => ({ submitAction: vi.fn() }));

const owner = "1EiR6tc8jtVK6boR5w1chjq17XEXXHiNk4";
const archive = "1WhPkYjyS1ChEKmbxNAyFUHLuRVQCjNMF";
const originalBanner = new Uint8Array(32).fill(61);
const original = buildProfileDocument({ display_name: "Ella", bio: "Music", links: ["https://example.org"], banner_photo_hash: originalBanner });
const view = { profileUri: original.uri, profileHash: toBase64url(original.hash) } as ProfileView;
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(preparePhoto).mockReset().mockResolvedValue(Uint8Array.of(255, 216, 255, 217));
  vi.stubGlobal("URL", class extends URL {
    static override createObjectURL() { return "blob:preview"; }
    static override revokeObjectURL() {}
  });
  mocks.session = { identity: { account: owner } };
  mocks.ctx = { client: { deployment: { contracts: { publications: { address: archive } } },
    reads: { identity: { get_identity: vi.fn().mockResolvedValue({ value: { profile_uri: original.uri } }) } },
    ops: { identity: { update_profile: vi.fn().mockResolvedValue({}) } } } };
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(<ProfileEditor account={owner} view={view} onDone={() => undefined}/>));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

async function selectPicture() {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["photo"], "face.jpg", { type: "image/jpeg" })] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
async function save() {
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

it("retries a partial photo upload using the same id and preserves the banner and existing profile fields", async () => {
  vi.mocked(archivePhoto).mockRejectedValueOnce(Error("Temporary upload failure")).mockResolvedValue(undefined);
  await selectPicture();
  expect(archivePhoto).not.toHaveBeenCalled();
  await save();
  expect(submitAction).not.toHaveBeenCalled();
  await save();
  const digest = contentHash(Uint8Array.of(255, 216, 255, 217));
  const location = photoLocation(archive, profilePhotoId(owner, digest));
  expect(vi.mocked(archivePhoto).mock.calls.map(args => args[0].url)).toEqual([location, location]);
  const { profile_uri } = mocks.ctx.client.ops.identity.update_profile.mock.calls[0][0];
  expect(parseProfileUri(profile_uri)).toMatchObject({ display_name: "Ella", bio: "Music",
    links: ["https://example.org"], avatar_photo_hash: digest, banner_photo_hash: originalBanner });
  expect(submitAction).toHaveBeenCalledTimes(1);
});

it("checks the on-chain profile before reserving image storage for a stale edit", async () => {
  mocks.ctx.client.reads.identity.get_identity.mockResolvedValue({ value: { profile_uri: "changed" } });
  await selectPicture();
  await save();
  expect(container.textContent).toContain("Your profile changed");
  expect(archivePhoto).not.toHaveBeenCalled();
  expect(submitAction).not.toHaveBeenCalled();
});


it.each(["Profile picture", "Profile banner"])("retains the selected %s file until it has finished reading", async label => {
  const input = Array.from(container.querySelectorAll<HTMLInputElement>('input[accept="image/*"]'))
    .find(input => input.closest(".field")?.textContent?.includes(label))!;
  let selection = "C:/fakepath/banner.jpg";
  Object.defineProperty(input, "value", { configurable: true, get: () => selection, set: value => { selection = value; } });
  Object.defineProperty(input, "files", { value: [new File(["photo"], "banner.jpg")] });
  let finish!: (bytes: Uint8Array) => void;
  vi.mocked(preparePhoto).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(selection).toBe("C:/fakepath/banner.jpg");
  await act(async () => finish(Uint8Array.of(255, 216, 255, 217)));
  expect(selection).toBe("");
  expect(container.querySelector(`img[alt="${label}"]`)).not.toBeNull();
});

it.each(["Profile picture", "Profile banner"])("can recover an unreadable %s via the unfiltered file picker", async label => {
  const input = Array.from(container.querySelectorAll<HTMLInputElement>('input[accept="image/*"]'))
    .find(input => input.closest(".field")?.textContent?.includes(label))!;
  const file = new File(["photo"], "banner.jpg");
  Object.defineProperty(input, "files", { value: [file] });
  vi.mocked(preparePhoto).mockRejectedValueOnce(new PhotoReadError("NotReadableError"));
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  const retry = container.querySelector<HTMLInputElement>('input[aria-label="Choose profile image from files"]')!;
  expect(retry.hasAttribute("accept")).toBe(false);
  const open = vi.spyOn(retry, "click");
  const button = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Choose from files")!;
  await act(async () => button.click());
  expect(open).toHaveBeenCalledOnce();
  Object.defineProperty(retry, "files", { value: [file] });
  await act(async () => retry.dispatchEvent(new Event("change", { bubbles: true })));
  expect(preparePhoto).toHaveBeenLastCalledWith(file, expect.any(AbortSignal), label === "Profile picture" ? 131072 : PHOTO_MAX_BYTES);
  expect(container.querySelector(`img[alt="${label}"]`)).not.toBeNull();
  expect(container.textContent).not.toContain("could not read");
  expect(archivePhoto).not.toHaveBeenCalled();
});
