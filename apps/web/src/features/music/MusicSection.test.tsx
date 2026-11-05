import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ProtocolClient,
  identityFromSeed,
  contentHash,
  toBase64url,
} from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../../testing/fixtures";
import { MusicSection } from "./MusicSection";
import { prepareAudio, uploadMusic, loadMusic } from "./musicService";
const mocks = vi.hoisted(() => ({
  services: {} as any,
  session: undefined as any,
  submit: undefined as any,
  lease: { renew: vi.fn(), release: vi.fn() },
  keepUnlocked: vi.fn(),
  storage: { load: vi.fn(), save: vi.fn(), clear: vi.fn() },
}));
vi.mock("../../api/services", () => ({ useServices: () => mocks.services }));
vi.mock("../../vault/context", () => ({
  useVault: (select: any) =>
    select({
      session: mocks.session,
      account: mocks.session?.identity.account,
      status: "unlocked",
    }),
  useVaultStore: () => ({ getState: () => ({ session: mocks.session, keepUnlocked: mocks.keepUnlocked }) }),
}));
vi.mock("../session", () => ({ useSubmitContext: () => mocks.submit, useMe: () => mocks.session?.identity, useCanAct: () => ({ ok: !!mocks.session }) }));
vi.mock("./musicService", async () => ({
  ...(await vi.importActual<typeof import("./musicService")>("./musicService")),
  musicDraftStore: async () => mocks.storage,
  prepareAudio: vi.fn(),
  uploadMusic: vi.fn(),
  loadMusic: vi.fn(),
}));
let box: HTMLDivElement, root: Root;
const me = identityFromSeed(new Uint8Array(32).fill(8)),
  other = identityFromSeed(new Uint8Array(32).fill(9));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.keepUnlocked.mockReturnValue(mocks.lease);
  const client = new ProtocolClient({
    rpc: fakeProvider(),
    deployment: fixtureDeployment(),
  });
  mocks.services = { protocol: client, indexer: { configured: false }, resolved: { network: "harbinger" } };
  mocks.session = { identity: me };
  mocks.submit = { client, signer: me.signer, payment: "sponsor-only" };
  mocks.storage.load.mockResolvedValue(undefined);
  mocks.storage.save.mockResolvedValue(undefined);
  mocks.storage.clear.mockResolvedValue(undefined);
  vi.spyOn(client.reads.publications, "get_music_config").mockResolvedValue({
    value: {
      version: 1,
      revision: 1,
      native_token: other.account,
      recipient: other.account,
      rate_per_mb: "8610000000",
      max_bytes: 10485760,
      enabled: true,
    },
  });
  vi.spyOn(client.reads.publications, "list_music").mockResolvedValue({
    ids: [],
  });
  vi.spyOn(client.reads.publications, "get_music").mockResolvedValue({});
  box = document.createElement("div");
  document.body.appendChild(box);
  root = createRoot(box);
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.restoreAllMocks();
});
async function mount(owner = me.account) {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <MusicSection owner={owner} />
      </MemoryRouter>
    )
  );
}
it("shows the 3:30 quote before any payment and saves recovery before uploading", async () => {
  await mount();
  const bytes = new Uint8Array(8403113).fill(1);
  vi.mocked(prepareAudio).mockResolvedValue({
    bytes,
    mime: "audio/mpeg",
    durationMs: 210000,
  });
  vi.mocked(uploadMusic).mockResolvedValue(undefined);
  const input = box.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    value: [new File(["test"], "Full song.mp3", { type: "audio/mpeg" })],
  });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true }))
  );
  expect(box.textContent).toContain("3:30");
  expect(box.textContent).toContain("724 tKOIN");
  expect(uploadMusic).not.toHaveBeenCalled();
  const pay = [...box.querySelectorAll<HTMLButtonElement>("button")].find((x) =>
    x.textContent?.includes("Pay 724")
  )!;
  expect(pay.disabled).toBe(false);
  await act(async () => pay.click());
  expect(uploadMusic).toHaveBeenCalledOnce();
  expect(mocks.keepUnlocked).toHaveBeenCalledOnce();
  expect(mocks.lease.release).toHaveBeenCalledOnce();
  expect(vi.mocked(uploadMusic).mock.calls[0]![1].fee).toBe("72400000000");
  expect(mocks.storage.save.mock.invocationCallOrder[0]!).toBeLessThan(
    vi.mocked(uploadMusic).mock.invocationCallOrder[0]!
  );
  expect(box.textContent).toContain("published on your profile");
});
it("provides public playback on another profile without upload controls", async () => {
  const id = new Uint8Array(32).fill(5),
    bytes = new Uint8Array([1, 2]);
  const record = {
    owner: other.account,
    payer: other.account,
    recipient: me.account,
    fee: "100000000",
    title: "Public song",
    mime: "audio/mpeg",
    size: bytes.length,
    duration_ms: 210000,
    digest: contentHash(bytes),
    chunk_hashes: [contentHash(bytes)],
    received: 1,
  };
  vi.mocked(
    mocks.services.protocol.reads.publications.list_music
  ).mockResolvedValue({ ids: [id] });
  vi.mocked(
    mocks.services.protocol.reads.publications.get_music
  ).mockResolvedValue({ value: record });
  vi.mocked(loadMusic).mockResolvedValue({ record, bytes });
  const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:music-test"),
    revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  await mount(other.account);
  expect(box.querySelector('input[type="file"]')).toBeNull();
  const button = [...box.querySelectorAll<HTMLButtonElement>("button")].find(
    (x) => x.textContent === "Load & play"
  )!;
  await act(async () => button.click());
  expect(loadMusic).toHaveBeenCalledWith(
    mocks.services.protocol,
    toBase64url(id),
    expect.any(AbortSignal),
    expect.any(Function)
  );
  expect(create).toHaveBeenCalledOnce();
  expect(box.querySelector("audio")?.controls).toBe(true);
  await act(async () => root.render(<div />));
  expect(revoke).toHaveBeenCalledWith("blob:music-test");
});

async function startPendingUpload() {
  await mount();
  vi.mocked(prepareAudio).mockResolvedValue({ bytes: new Uint8Array(10), mime: "audio/mpeg", durationMs: 1000 });
  const input = box.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["test"], "Test.mp3", { type: "audio/mpeg" })] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  const button = [...box.querySelectorAll<HTMLButtonElement>("button")].find((x) => x.textContent?.startsWith("Pay "))!;
  await act(async () => button.click());
}
it("renews upload protection on progress and releases it immediately when paused", async () => {
  let finish!: () => void;
  vi.mocked(uploadMusic).mockImplementation(() => new Promise<void>((r) => { finish = r; }));
  await startPendingUpload();
  expect(box.textContent).toContain("Auto-lock is paused");
  const [, , , assertActive, progress] = vi.mocked(uploadMusic).mock.calls[0]!;
  await act(async () => progress(1, 2, true));
  expect(mocks.lease.renew).toHaveBeenCalledOnce();
  await act(async () => [...box.querySelectorAll<HTMLButtonElement>("button")].find((x) => x.textContent === "Pause")!.click());
  expect(mocks.lease.release).toHaveBeenCalledOnce();
  expect(() => assertActive()).toThrow("Upload paused");
  await act(async () => progress(2, 2, true));
  expect(mocks.lease.renew).toHaveBeenCalledOnce();
  await act(async () => finish());
});
it("releases upload protection on navigation and rejects further signing", async () => {
  let finish!: () => void;
  vi.mocked(uploadMusic).mockImplementation(() => new Promise<void>((r) => { finish = r; }));
  await startPendingUpload();
  const assertActive = vi.mocked(uploadMusic).mock.calls[0]![3];
  await act(async () => root.render(<div />));
  expect(mocks.lease.release).toHaveBeenCalledOnce();
  expect(() => assertActive()).toThrow("Upload paused");
  await act(async () => finish());
});
it("releases protection on upload error and preserves the recovery draft", async () => {
  vi.mocked(uploadMusic).mockRejectedValue(new Error("Network unavailable"));
  await startPendingUpload();
  expect(mocks.lease.release).toHaveBeenCalledOnce();
  expect(mocks.storage.clear).not.toHaveBeenCalled();
  expect(box.textContent).toContain("Network unavailable");
});
