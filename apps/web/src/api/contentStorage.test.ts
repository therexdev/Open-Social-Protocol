import { expect, it, vi } from "vitest";
import { ProtocolClient, contentHash, encode, encryptMedia, fromBase64url, identityFromSeed, parseContentReference, parseContentReferenceUri, toBase64url, utf8, type ProtoObject } from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../testing/fixtures";
import { configureMediaStorage } from "./mediaStorage";
import { prepareHostedContent } from "./contentStorage";

const me = identityFromSeed(new Uint8Array(32).fill(71));
function fixture(version = 1) {
  const provider = fakeProvider({ onRead: () => encode("publications.get_library_version_result", { version: 1, external_media_version: 1, content_reference_version: version }) });
  const client = new ProtocolClient({ rpc: provider, deployment: fixtureDeployment() });
  const files = new Map<string, Uint8Array>(), endpoint = "https://uploads.example/v1/media", publicUrl = "https://media.example";
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== endpoint) return new Response(new Uint8Array(files.get(url)!));
    if (init?.method === "POST") {
      const bytes = new Uint8Array(init.body as Uint8Array), hash = toBase64url(contentHash(bytes));
      const location = `${publicUrl}/osp/network/identity/${hash}`; files.set(location, bytes);
      return new Response(JSON.stringify({ url: location, hash, size: bytes.length }));
    }
    return new Response(JSON.stringify({ enabled: true, provider: "r2", chainId: client.chainId, contract: client.deployment.contracts.identity.address, maxFileBytes: 10485760, publicUrl }));
  });
  configureMediaStorage(client, endpoint, fetchFn as typeof fetch);
  return { client, provider, fetchFn, files, ctx: { client, signer: me.signer, payment: "self-only" as const } };
}
it("removes post bodies and poll wording from the operation while preserving IDs, audience and voting controls", async () => {
  const f = fixture(), envelope = utf8("original encoded post envelope"), hash = contentHash(envelope);
  const op = await f.client.ops.publications.publish({ author: me.account, post_id: new Uint8Array(32).fill(7), content_hash: hash, envelope, audience: 0, epoch: 0, version_number: 1, poll: { question: "Lunch?", options: ["Pizza", "Soup"], closes_at: "900000" } } as never);
  const [hosted] = await prepareHostedContent(f.ctx, [op]);
  const args = f.client.contracts.decodeOperation(hosted!)!.args;
  expect(parseContentReference(args.envelope as Uint8Array)).toEqual({ digest: hash, size: envelope.length });
  expect(args).toMatchObject({ author: me.account, post_id: new Uint8Array(32).fill(7), content_hash: hash, audience: 0, epoch: 0 });
  const poll = args.poll as ProtoObject;
  expect(parseContentReferenceUri(poll.question as string)).toBeDefined();
  expect(poll).toMatchObject({ options: ["0", "1"], closes_at: "900000" });
  expect(JSON.stringify(args)).not.toContain("Lunch");
  expect(f.files.size).toBe(2);
  expect(f.client.contracts.decodeOperation(op)!.args.envelope).toEqual(envelope);
});
it("uploads only the original encrypted packet and signs hosting with the account rather than its conversation alias", async () => {
  const f = fixture(), alias = identityFromSeed(new Uint8Array(32).fill(72));
  f.client.reads.messaging.get_private_status = vi.fn().mockResolvedValue({ version: 2, content_reference_version: 1 });
  const ciphertext = encryptMedia(utf8("secret friend message")).ciphertext;
  const op = await f.client.ops.messaging.post_private_packet({ actor: alias.account, packet_id: new Uint8Array(32), envelope: ciphertext });
  const [hosted] = await prepareHostedContent({ ...f.ctx, signer: alias.signer, contentSigner: { account: me.account, signer: me.signer } }, [op]);
  expect(parseContentReference(f.client.contracts.decodeOperation(hosted!)!.args.envelope as Uint8Array)?.digest).toEqual(contentHash(ciphertext));
  const [, init] = f.fetchFn.mock.calls.find(([, init]) => init?.method === "POST")!;
  const proof = JSON.parse(new TextDecoder().decode(fromBase64url((init!.headers as Record<string, string>)["x-osp-media-proof"]!)));
  expect(proof).toMatchObject({ account: me.account, signer: me.account });
  expect([...f.files.values()]).toEqual([ciphertext]);
});
it("moves group metadata, captions, music comments, music descriptions and profile documents off chain", async () => {
  const f = fixture(), bytes = utf8("original body"), id = new Uint8Array(32).fill(9);
  const operations = [
    await f.client.ops.publications.save_collection({ owner: me.account, id, kind: 1, audience: 0, members: [], envelope: bytes, previous_revision: 0 }),
    await f.client.ops.publications.set_album_item({ owner: me.account, collection_id: id, id, epoch: 1, previous_revision: 0, envelope: bytes }),
    await f.client.ops.publications.comment_music({ author: me.account, id, comment_id: id, body: bytes }),
    await f.client.ops.publications.begin_music({ owner: me.account, id, digest: contentHash(bytes), size: bytes.length, chunk_hashes: [contentHash(bytes)], title: "Song", artist: "Artist", description: "Lyrics", mime: "audio/mpeg" } as never),
    await f.client.ops.identity.update_profile({ account: me.account, profile_hash: contentHash(bytes), profile_uri: `data:application/x-osp-profile;base64,${toBase64url(bytes)}` }),
  ];
  const hosted = (await prepareHostedContent(f.ctx, operations)).map(op => f.client.contracts.decodeOperation(op)!.args);
  expect(hosted.slice(0, 2).every(a => parseContentReference(a.envelope as Uint8Array))).toBe(true);
  expect(parseContentReference(hosted[2]!.body as Uint8Array)).toBeDefined();
  expect(hosted[3]).toMatchObject({ artist: "", description: "" });
  expect(parseContentReferenceUri(hosted[3]!.title as string)).toBeDefined();
  expect(parseContentReferenceUri(hosted[4]!.profile_uri as string)?.digest).toEqual(contentHash(bytes));
});
it("fails before upload on an old contract and never substitutes inline content on hosting errors", async () => {
  const f = fixture(0), bytes = utf8("post");
  const op = await f.client.ops.publications.publish({ author: me.account, post_id: new Uint8Array(32), content_hash: contentHash(bytes), envelope: bytes } as never);
  await expect(prepareHostedContent(f.ctx, [op])).rejects.toThrow("not deployed");
  expect(f.fetchFn).not.toHaveBeenCalled();
  f.client.reads.publications.get_library_version = vi.fn().mockResolvedValue({ content_reference_version: 1 });
  f.fetchFn.mockRejectedValue(Error("offline"));
  await expect(prepareHostedContent(f.ctx, [op])).rejects.toThrow("offline");
  expect(f.client.contracts.decodeOperation(op)!.args.envelope).toEqual(bytes);
});
