import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { contentHash, fromBase64url, identityFromSeed, musicCommentCipher, musicKeyContext, openMedia, ProtocolClient, toBase64url, type MusicRecord } from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../../testing/fixtures";
import { VoiceCommentForm } from "./VoiceCommentForm";
import { archiveClip } from "../media/clipArchive";
import { submitAction } from "../../tx/submit";
import { decodeMusicComment } from "./voiceComment";

const mock = vi.hoisted(() => ({ services: {} as any, session: {} as any, submit: {} as any, stored: undefined as any }));
vi.mock("../../api/services", () => ({ useServices: () => mock.services }));
vi.mock("../../vault/context", () => ({ useVault: (fn: any) => fn({ session: mock.session }), useVaultStore: () => ({ getState: () => ({session: mock.session}) }) }));
vi.mock("../session", () => ({ useSubmitContext: () => mock.submit }));
vi.mock("../../tx/submit", () => ({ submitAction: vi.fn() }));
vi.mock("../media/clipArchive", async real => ({ ...await real<typeof import("../media/clipArchive")>(), archiveClip: vi.fn() }));
vi.mock("./voiceComment", async real => ({ ...await real<typeof import("./voiceComment")>(), voiceCommentStore: async () => ({
  load: async () => mock.stored,
  save: async (value: unknown) => { mock.stored = structuredClone(value); },
  clear: async () => { mock.stored = undefined; },
}) }));
vi.mock("./musicAccessService", async real => ({ ...await real<typeof import("./musicAccessService")>(), readingKey: async () => new Uint8Array(32).fill(5) }));
vi.mock("../media/MediaCapture", () => ({MediaCapture: ({onChange}:any) => <button onClick={() => onChange({
  file: { size: 20, arrayBuffer: async () => new Uint8Array(20).fill(88).buffer }, mime:"audio/webm", durationMs:5000,
})}>Test microphone</button>}));

it("resumes the encrypted recording and exact comment after reopening a failed song reply", async () => {
  const client = new ProtocolClient({ rpc: fakeProvider(), deployment: fixtureDeployment() });
  const account = identityFromSeed(new Uint8Array(32).fill(7));
  mock.services = {protocol: client}; mock.session = {identity:account};
  mock.submit = {client, signer:account.signer, payment:"sponsor-only"};
  const id = toBase64url(new Uint8Array(32).fill(8)), parent = toBase64url(new Uint8Array(32).fill(9));
  const record = { encrypted:true, owner:account.account } as MusicRecord;
  const posted = vi.fn(), box = document.createElement("div");
  const render = async () => {
    const root = createRoot(box);
    await act(async () => root.render(<VoiceCommentForm track={id} record={record} caption="Testing" replyTo={parent} onPosted={posted}/>));
    return root;
  };
  const click = async (label:string) => {
    const button = [...box.querySelectorAll("button")].find(b => b.textContent === label);
    expect(button?.disabled).toBe(false);
    await act(async () => button!.click());
  };
  vi.mocked(archiveClip).mockRejectedValueOnce(Error("interrupted")).mockResolvedValueOnce();
  let root = await render();
  await click("Test microphone"); await click("Post voice comment");
  expect(submitAction).not.toHaveBeenCalled();
  const saved = structuredClone(mock.stored);
  await act(async () => root.unmount());
  root = await render(); await click("Resume voice comment");
  const disk = vi.mocked(archiveClip).mock.calls[1]![0];
  expect(disk.url).toBe(saved.voice.url);
  const call = client.contracts.decodeOperation(vi.mocked(submitAction).mock.calls[0]![1][0]!)!;
  expect(call.method).toBe("comment_music"); expect(call.args.reply_to).toEqual(fromBase64url(parent)); expect(toBase64url(call.args.body as Uint8Array)).toBe(saved.body);
  const plain = musicCommentCipher(musicKeyContext(client.chainId,client.deployment.contracts.publications.address,fromBase64url(id),account.account),
    new Uint8Array(32).fill(5),call.args.nonce as Uint8Array,call.args.comment_id as Uint8Array,account.account).decrypt(call.args.body as Uint8Array);
  const opened = decodeMusicComment(plain,true), bytes = fromBase64url(disk.archiveBytes!);
  expect(opened.text).toBe("Testing"); expect(opened.voice!.contentHash).toEqual(contentHash(bytes));
  expect(openMedia(bytes,opened.voice!.contentHash,{key:fromBase64url(opened.voice!.encryption!.key),nonce:fromBase64url(opened.voice!.encryption!.nonce)})).toEqual(new Uint8Array(20).fill(88));
  expect(posted).toHaveBeenCalledTimes(1); expect(mock.stored).toBeUndefined();
  await act(async () => root.unmount());
});
