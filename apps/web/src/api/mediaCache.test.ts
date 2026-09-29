import { afterEach, expect, it, vi } from "vitest";
import { contentHash, encryptMedia, toBase64url, utf8 } from "@osp/sdk";
import { cachedMediaBytes, rememberMediaBytes } from "./mediaCache";
const cid = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqw4j4k2pm";
afterEach(() => vi.useRealTimers());
it("retains only encrypted file bytes for private uploads and isolates returned buffers", () => {
  const plain = utf8("private pixels"), encrypted = encryptMedia(plain), hash = toBase64url(encrypted.contentHash);
  rememberMediaBytes(cid, hash, encrypted.ciphertext);
  const cached = cachedMediaBytes(cid, hash)!;
  expect(cached).toEqual(encrypted.ciphertext); expect(cached).not.toEqual(plain);
  cached.fill(0);
  expect(cachedMediaBytes(cid, hash)).toEqual(encrypted.ciphertext);
  expect(() => rememberMediaBytes(cid, hash, plain)).toThrow(/fingerprint/);
});
it("expires recent images rather than retaining them indefinitely", () => {
  vi.useFakeTimers(); const bytes = utf8("expiring photo"), hash = toBase64url(contentHash(bytes));
  rememberMediaBytes(cid, hash, bytes);
  expect(cachedMediaBytes(cid, hash)).toEqual(bytes);
  vi.advanceTimersByTime(300001);
  expect(cachedMediaBytes(cid, hash)).toBeUndefined();
});
