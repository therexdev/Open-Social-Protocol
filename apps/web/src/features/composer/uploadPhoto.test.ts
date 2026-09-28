// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { fromBase64url, identityFromSeed, openMedia, utf8, utf8Decode, verifyMediaUpload } from "@osp/sdk";
import { uploadPhoto } from "./uploadPhoto";
const identity = identityFromSeed(new Uint8Array(32).fill(91));
const cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqw4j4k2pm";
const options = { endpoint: "https://upload.test/v1/media",chainId: "chain",contract: "identity",identity };
describe("photo upload privacy", () => {
  it.each([false,true])("uploads authenticated bytes and keeps private secrets out of the request (private=%s)", async isPrivate => {
    const source = utf8("photo bytes"), requests: RequestInit[] = [];
    const fetchFn = vi.fn(async (_url: unknown,request?: RequestInit) => {
      requests.push(request!);
      const proof = JSON.parse(utf8Decode(fromBase64url((request!.headers as Record<string,string>)["x-osp-media-proof"]!)));
      expect(verifyMediaUpload(proof,proof.signature)).toBe(true);
      expect(proof.mime).toBe(isPrivate ? "application/octet-stream" : "image/jpeg");
      expect(proof).not.toHaveProperty("key"); expect(proof).not.toHaveProperty("nonce");
      return new Response(JSON.stringify({ url: `ipfs://${cid}`,hash: proof.hash,size: proof.size }));
    });
    const media = await uploadPhoto(source,{ ...options,private: isPrivate,fetch: fetchFn });
    const uploaded = requests[0]!.body as Uint8Array;
    expect(!!media.encryption).toBe(isPrivate);
    if (isPrivate) expect(uploaded).not.toEqual(source); else expect(uploaded).toEqual(source);
    expect(openMedia(uploaded,media.contentHash,media.encryption ? { key: fromBase64url(media.encryption.key),nonce: fromBase64url(media.encryption.nonce) } : undefined)).toEqual(source);
  });
  it("rejects a mismatched receipt, an insecure upload URL and a cancelled upload", async () => {
    const source = utf8("photo"), fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: `ipfs://${cid}`,hash: "wrong",size: 5 })));
    await expect(uploadPhoto(source,{ ...options,private: false,fetch: fetchFn })).rejects.toThrow(/invalid photo receipt/);
    await expect(uploadPhoto(source,{ ...options,endpoint: "http://insecure.test",private: false })).rejects.toThrow(/HTTPS/);
    const controller = new AbortController(); controller.abort(); fetchFn.mockClear();
    await expect(uploadPhoto(source,{ ...options,private: true,signal: controller.signal,fetch: fetchFn })).rejects.toThrow(/cancelled/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
