import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { contentHash, photoLocation, profilePhotoId, toBase64url } from "@osp/sdk";
import { ProfileEditor } from "./ProfileEditor";
import { buildProfileDocument, parseProfileUri } from "../../api/profiles";
import type { ProfileView } from "../../api/indexer";
import { archivePhoto } from "../composer/archivePhoto";
import { submitAction } from "../../tx/submit";

const mocks = vi.hoisted(() => ({ ctx: {} as any, session: {} as any }));
vi.mock("../session", () => ({ useSubmitContext: () => mocks.ctx }));
vi.mock("../../vault/context", () => ({ useVaultStore: () => ({ getState: () => ({ session: mocks.session }) }) }));
vi.mock("../composer/preparePhoto", () => ({ preparePhoto: async () => Uint8Array.of(255, 216, 255, 217) }));
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
