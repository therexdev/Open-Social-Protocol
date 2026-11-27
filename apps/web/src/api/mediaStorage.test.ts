import { expect, it, vi } from "vitest";
import { contentHash, encryptMedia, HOSTED_FILE_MAX_BYTES, MEDIA_UPLOAD_PART_BYTES, identityFromSeed, ProtocolClient, toBase64url, utf8 } from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../testing/fixtures";
import { configureMediaStorage, fetchStoredMedia, uploadStoredMedia, uploadStoredBlob } from "./mediaStorage";
const identity = identityFromSeed(new Uint8Array(32).fill(73));
const endpoint = "https://uploads.example/v1/media", publicUrl = "https://media.example";
function fixture(bytes: Uint8Array) {
  const client = new ProtocolClient({ rpc: fakeProvider(), deployment: fixtureDeployment() });
  const hash = toBase64url(contentHash(bytes)), location = `${publicUrl}/osp/test/${hash}`;
  const fetchFn = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (_url === location) return new Response(new Uint8Array(bytes));
    return new Response(JSON.stringify(init?.method === "POST" ? { url: location, hash, size: bytes.length } : {
      enabled: true, provider: "r2", chainId: client.chainId, contract: client.deployment.contracts.identity.address, maxFileBytes: 10485760, publicUrl,
    }));
  });
  configureMediaStorage(client, endpoint, fetchFn);
  return { client, fetchFn, location, ctx: { client, signer: identity.signer, payment: "self-only" as const } };
}
it("uploads only existing ciphertext, verifies delivery and never sends media keys", async () => {
  const encrypted = encryptMedia(utf8("private photo")), f = fixture(encrypted.ciphertext);
  expect(await uploadStoredMedia(f.ctx, identity.account, encrypted.ciphertext)).toBe(f.location);
  const init = f.fetchFn.mock.calls[1]![1] as RequestInit;
  expect(init.body).toEqual(encrypted.ciphertext);
  expect(JSON.stringify(init.headers)).not.toContain(toBase64url(encrypted.key));
  expect(f.fetchFn).toHaveBeenCalledTimes(3);
});
it("refuses unconfigured storage without sending a POST", async () => {
  const f = fixture(utf8("photo"));
  f.fetchFn.mockResolvedValue(new Response(JSON.stringify({ enabled: false, provider: null })));
  await expect(uploadStoredMedia(f.ctx, identity.account, utf8("photo"))).rejects.toThrow("not enabled");
  expect(f.fetchFn).toHaveBeenCalledTimes(1);
});
it("rejects a corrupt stored file, redirects and non-HTTPS locations", async () => {
  const bytes = utf8("ciphertext");
  const fetchFn = vi.fn().mockResolvedValue(new Response(new Uint8Array(utf8("tampered"))));
  await expect(fetchStoredMedia("https://media.example/file", contentHash(bytes), bytes.length, undefined, fetchFn)).rejects.toThrow("fingerprint");
  await expect(fetchStoredMedia("http://localhost/file", contentHash(bytes), bytes.length, undefined, fetchFn)).rejects.toThrow("HTTPS");
  expect(fetchFn.mock.calls[0]![1]).toMatchObject({ credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
});
it("stops signing or committing after the account locks", async () => {
  const bytes = utf8("photo"), f = fixture(bytes);
  const active = vi.fn().mockImplementationOnce(() => {}).mockImplementation(() => { throw Error("locked"); });
  await expect(uploadStoredMedia(f.ctx, identity.account, bytes, active)).rejects.toThrow("locked");
  expect(f.fetchFn).toHaveBeenCalledTimes(1);
});

it("sends a long recording as small Blob slices and checks its receipt without a second full download", async () => {
  const bytes = new Uint8Array(MEDIA_UPLOAD_PART_BYTES + 10), f = fixture(bytes), blob = new Blob([bytes]);
  Object.defineProperty(blob, "arrayBuffer", { value: () => { throw Error("Do not copy the whole recording"); } });
  const receipt = { url: f.location, hash: toBase64url(contentHash(bytes)), size: bytes.length };
  const parts: number[] = [], session = { id: "a".repeat(32), token: "b".repeat(64), received: 0, partBytes: MEDIA_UPLOAD_PART_BYTES };
  f.fetchFn.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === endpoint) return new Response(JSON.stringify({ enabled: true, provider: "r2", chainId: f.client.chainId, contract: f.client.deployment.contracts.identity.address, publicUrl,
      multipart: { version: 1, partBytes: MEDIA_UPLOAD_PART_BYTES, maxFileBytes: HOSTED_FILE_MAX_BYTES } }));
    if (url.endsWith("/uploads")) return new Response(JSON.stringify(session));
    if (url.includes("/part?")) { const part = init!.body as Blob; parts.push(part.size); session.received += part.size; return new Response(JSON.stringify({ received: session.received })); }
    if (url.endsWith("/complete")) return new Response(JSON.stringify({ receipt }));
    if (url === receipt.url && init?.method === "HEAD") return new Response(null, { headers: { "content-length": String(bytes.length) } });
    throw Error("Unexpected request");
  });
  expect(await uploadStoredBlob(f.ctx, identity.account, blob, contentHash(bytes))).toBe(f.location);
  expect(parts).toEqual([MEDIA_UPLOAD_PART_BYTES, 10]);
  expect(f.fetchFn.mock.calls.filter(([url]) => url === receipt.url)).toHaveLength(1);
});

it("explains an older hosting service's limit before sending a large body", async () => {
  const f = fixture(utf8("small"));
  const blob = { size: 100 * 1024 * 1024, arrayBuffer: vi.fn() } as unknown as Blob;
  await expect(uploadStoredBlob(f.ctx, identity.account, blob, new Uint8Array(32))).rejects.toThrow("large-upload update");
  expect(blob.arrayBuffer).not.toHaveBeenCalled(); expect(f.fetchFn).toHaveBeenCalledTimes(1);
});
