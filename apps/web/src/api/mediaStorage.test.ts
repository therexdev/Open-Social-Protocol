import { expect, it, vi } from "vitest";
import { contentHash, encryptMedia, identityFromSeed, ProtocolClient, toBase64url, utf8 } from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../testing/fixtures";
import { configureMediaStorage, fetchStoredMedia, uploadStoredMedia } from "./mediaStorage";
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
