import { describe, it, expect } from "vitest";
import { contentHash } from "./ids.js";
import {
  photoCost,
  photoChunks,
  verifyPhotoChunks,
  photoLocation,
  parsePhotoLocation,
  PHOTO_MAX_BYTES,
} from "./photoLibrary.js";
describe("archive prices and verification", () => {
  it("prices every boundary and includes ciphertext overhead", () => {
    expect(
      [
        1, 32768, 32769, 65536, 65537, 131072, 131073, 229376, 229377, 327680,
      ].map(photoCost)
    ).toEqual([1, 1, 2, 2, 4, 4, 7, 7, 10, 10]);
    expect(photoCost(32768 + 16)).toBe(2);
    for (const invalid of [0, -1, 1.5, NaN, Infinity, PHOTO_MAX_BYTES + 1])
      expect(() => photoCost(invalid)).toThrow();
  });
  it("rejects incomplete, reordered, modified and cross-archive bytes", () => {
    const bytes = new Uint8Array(32769).map((_, i) => i % 251),
      chunks = photoChunks(bytes),
      hash = contentHash(bytes);
    const record = {
      owner: "owner",
      digest: hash,
      size: bytes.length,
      chunk_hashes: chunks.map(contentHash),
      received: chunks.length,
      units: photoCost(bytes.length),
    };
    expect(verifyPhotoChunks(record, chunks, hash)).toEqual(bytes);
    expect(() =>
      verifyPhotoChunks({ ...record, received: 2 }, chunks, hash)
    ).toThrow("incomplete");
    expect(() =>
      verifyPhotoChunks(record, [chunks[1]!, chunks[0]!, chunks[2]!], hash)
    ).toThrow();
    const altered = chunks.map((c) => c.slice());
    altered[0]![0] ^= 1;
    expect(() => verifyPhotoChunks(record, altered, hash)).toThrow("chunk");
    expect(() => verifyPhotoChunks(record, chunks, new Uint8Array(32))).toThrow(
      "fingerprint"
    );
    const location = photoLocation("contract", hash);
    expect(parsePhotoLocation(location, "contract")).toEqual(hash);
    expect(() => parsePhotoLocation(location, "other")).toThrow(
      "another archive"
    );
  });
});
