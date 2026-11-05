import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  contentHash,
  fromBase64url,
  identityFromSeed,
  musicCommentCipher,
  musicKeyContext,
  musicEngagementId,
  newEpochKey,
  ProtocolClient,
  sealMusicKey,
  toBase64url,
  utf8,
  utf8Decode,
  type MusicAccess,
  type MusicRecord,
} from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../../testing/fixtures";
import { encodeVoiceComment } from "./voiceComment";
import { MusicPage } from "./MusicPage";
import { submitAction } from "../../tx/submit";
const mocks = vi.hoisted(() => ({
  services: {} as any,
  session: undefined as any,
  submit: undefined as any,
}));
vi.mock("../../api/services", () => ({ useServices: () => mocks.services }));
vi.mock("../../vault/context", () => ({
  useVault: (selector: any) => selector({ session: mocks.session }),
  useVaultStore: () => ({ getState: () => ({ session: mocks.session }) }),
}));
vi.mock("../session", () => ({ useSubmitContext: () => mocks.submit, useMe: () => mocks.session?.identity, useCanAct: () => ({ ok: !!mocks.session }) }));
vi.mock("../tokens/EconomyContext", () => ({ useEconomy: () => ({ version: 1, policy: {
  max_vote_weight: "1000", promotion_price: "1", max_opportunities: 5, promotion_slots: 32, promotion_interval: "1200",
} }) }));
vi.mock("../../tx/submit", () => ({ submitAction: vi.fn() }));
const owner = identityFromSeed(new Uint8Array(32).fill(7)),
  buyer = identityFromSeed(new Uint8Array(32).fill(8)),
  id = new Uint8Array(32).fill(12),
  textId = toBase64url(id),
  key = newEpochKey();
let box: HTMLDivElement,
  root: Root,
  client: ProtocolClient,
  record: MusicRecord,
  access: MusicAccess | undefined,
  eligible: boolean,
  comments: any[],
  now: string;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(submitAction).mockReset();
  client = new ProtocolClient({ rpc: fakeProvider(), deployment: fixtureDeployment() });
  mocks.services = { protocol: client, indexer: { configured: false } };
  mocks.session = { identity: buyer };
  mocks.submit = { client, signer: buyer.signer, payment: "sponsor-only" };
  const context = musicKeyContext(
    client.chainId,
    client.deployment.contracts.publications.address,
    id,
    owner.account
  );
  record = {
    owner: owner.account,
    payer: owner.account,
    recipient: owner.account,
    fee: "100000000",
    size: 20,
    chunk_hashes: [new Uint8Array(32)],
    digest: new Uint8Array(32),
    received: 1,
    title: "Good Vibes",
    artist: "Test Artist",
    description: "A song description",
    mime: "audio/mpeg",
    duration_ms: 210000,
    version: 2,
    encrypted: true,
    audience: 0,
    unlock_price: "25",
    nonce: new Uint8Array(24),
    key_hash: contentHash(key),
    owner_key: sealMusicKey(context, key, {
      address: owner.account,
      publicKey: owner.encryption.publicKey,
      keyVersion: 1,
    }),
  };
  access = undefined;
  eligible = true;
  comments = [];
  now = "1800000000000";
  vi.spyOn(client.reads.publications, "get_music").mockImplementation(async () => ({
    value: record,
  }));
  vi.spyOn(client.reads.publications, "get_music_access").mockImplementation(async () => ({
    value: access,
    eligible,
    now,
  }));
  vi.spyOn(client.reads.publications, "list_music_comments").mockImplementation(async () => ({
    items: comments,
    next: new Uint8Array(),
  }));
  vi.spyOn(client.reads.publications, "list_music_requests").mockResolvedValue({
    items: [],
    next: new Uint8Array(),
  });
  vi.spyOn(client.reads.publications, "get_music_chunk").mockResolvedValue({
    data: new Uint8Array(20),
  });
  vi.mocked(submitAction).mockImplementation(async (_ctx, ops, options) => {
    await options.beforeSubmit?.();
    const op = client.contracts.decodeOperation(ops[0]!)!;
    if (op.method === "request_music_access")
      access = {
        id,
        buyer: buyer.account,
        amount: "25",
        status: 1,
        expires_at: "1800086400000",
        key_version: 1,
        public_key: buyer.encryption.publicKey,
        payment_id: new Uint8Array(32),
      };
    else if (op.method === "refund_music_access") access!.status = 3;
    else if (op.method === "comment_music")
      comments.push({
        id: op.args.comment_id,
        author: buyer.account,
        body: op.args.body,
        nonce: op.args.nonce,
        reply_to: new Uint8Array(),
        created_at: now,
        deleted: false,
      });
    return {} as never;
  });
  box = document.createElement("div");
  document.body.appendChild(box);
  root = createRoot(box);
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.restoreAllMocks();
});
async function mount() {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[`/music/${textId}`]}>
        <Routes>
          <Route path="/music/:id" element={<MusicPage />} />
        </Routes>
      </MemoryRouter>
    )
  );
}
function button(text: string) {
  return [...box.querySelectorAll<HTMLButtonElement>("button")].find(
    (x) => x.textContent === text
  )!;
}
it("shows artist and description, reserves the exact OSAT price, and waits without exposing audio or comments", async () => {
  await mount();
  expect(box.textContent).toContain("Test Artist");
  expect(box.textContent).toContain("A song description");
  expect(box.querySelector("textarea")).toBeNull();
  expect(box.textContent).toContain("24 hours");
  await act(async () => button("Reserve 25 OSAT & request unlock").click());
  const op = client.contracts.decodeOperation(vi.mocked(submitAction).mock.calls[0]![1][0]!)!;
  expect(op.method).toBe("request_music_access");
  expect(op.args.max_price).toBe("25");
  expect(op.args.buyer).toBe(buyer.account);
  expect(box.textContent).toContain("Waiting for the uploader");
  expect(box.querySelector("audio")).toBeNull();
  expect(button("Reserve 25 OSAT & request unlock")).toBeUndefined();
  expect(client.reads.publications.get_music_chunk).not.toHaveBeenCalled();
});
it("enables encrypted comments only after a valid key has been delivered", async () => {
  const context = musicKeyContext(
    client.chainId,
    client.deployment.contracts.publications.address,
    id,
    owner.account
  );
  access = {
    id,
    buyer: buyer.account,
    amount: "25",
    status: 2,
    expires_at: "1800086400000",
    key_version: 1,
    public_key: buyer.encryption.publicKey,
    payment_id: new Uint8Array(32),
    key: sealMusicKey(context, key, {
      address: buyer.account,
      publicKey: buyer.encryption.publicKey,
      keyVersion: 1,
    }),
  };
  await mount();
  expect(box.textContent).toContain("Access delivered");
  const input = box.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Love this song"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    box
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  const op = client.contracts.decodeOperation(vi.mocked(submitAction).mock.calls[0]![1][0]!)!;
  expect(op.method).toBe("comment_music");
  expect(op.args.body).not.toEqual(utf8("Love this song"));
  expect(
    utf8Decode(
      musicCommentCipher(
        context,
        key,
        op.args.nonce as Uint8Array,
        op.args.comment_id as Uint8Array,
        buyer.account
      ).decrypt(op.args.body as Uint8Array)
    )
  ).toBe("Love this song");
  expect(box.textContent).toContain("Love this song");
});
it("keeps audience restrictions on paid tracks and offers an early refund after access is revoked", async () => {
  record.audience = 1;
  eligible = false;
  access = {
    id,
    buyer: buyer.account,
    amount: "25",
    status: 1,
    expires_at: "1800086400000",
    key_version: 1,
    public_key: buyer.encryption.publicKey,
    payment_id: new Uint8Array(32),
  };
  await mount();
  expect(box.querySelector("textarea")).toBeNull();
  expect(button("Reserve 25 OSAT & request unlock")).toBeUndefined();
  await act(async () => button("Refund OSAT").click());
  expect(
    client.contracts.decodeOperation(vi.mocked(submitAction).mock.calls[0]![1][0]!)!.method
  ).toBe("refund_music_access");
  expect(box.textContent).toContain("refunded or cancelled");
});
it("wrong delivered keys never enable private comments", async () => {
  const context = musicKeyContext(
    client.chainId,
    client.deployment.contracts.publications.address,
    id,
    owner.account
  );
  access = {
    id,
    buyer: buyer.account,
    amount: "25",
    status: 2,
    expires_at: "1800086400000",
    key_version: 1,
    public_key: buyer.encryption.publicKey,
    payment_id: new Uint8Array(32),
    key: sealMusicKey(context, newEpochKey(), {
      address: buyer.account,
      publicKey: buyer.encryption.publicKey,
      keyVersion: 1,
    }),
  };
  await mount();
  expect(box.querySelector("textarea")).toBeNull();
  expect(box.textContent).toContain("does not match this track");
});


it("submits emoji and paid votes against the voice comment and its confirmed body version", async () => {
  record = { ...record, audience: 0, encrypted: false, unlock_price: "0" };
  const cid = new Uint8Array(32).fill(54);
  const target = musicEngagementId(id, cid);
  const body = encodeVoiceComment("Listen", { url: `osp-clip://${client.deployment.contracts.publications.address}/${textId}`,
    mime: "audio/webm", size: 100, contentHash: new Uint8Array(32).fill(91) });
  comments = [{ id: cid, body, nonce: new Uint8Array(0), reply_to: new Uint8Array(0), author: owner.account, created_at: now, deleted: false }];
  vi.spyOn(client.reads.token, "get_post_economy").mockResolvedValue({ block: "100" });
  vi.spyOn(client.reads.token, "get_account").mockResolvedValue({ value: { resource_version: 2, token_ticks: "1440000", ticks_per_unit: "144000", balance: "10" } } as never);
  await mount();
  const row = box.querySelector(".music-comment")!;
  const click = async (label: string, scope: ParentNode) => act(async () => { scope.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(); });
  await click("React", row); await click("Happy", document);
  let op = client.contracts.decodeOperation(vi.mocked(submitAction).mock.lastCall![1][0]!)!;
  expect(op.method).toBe("react"); expect(op.args.post_id).toEqual(target);
  await click("Downvote", row);
  await act(async () => { row.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  op = client.contracts.decodeOperation(vi.mocked(submitAction).mock.lastCall![1][0]!)!;
  expect(op.method).toBe("vote");
  expect(op.args).toMatchObject({ post_id: target, version: contentHash(body), direction: 2, weight: "1" });
});
