import { expect, it } from "vitest";
import { contentHash } from "./ids.js";
import { toBase64url } from "./encoding.js";
import { hostedFileLocation, hostedFileUrl, HOSTED_FILE_MAX_BYTES, MEDIA_UPLOAD_PART_BYTES, openHostedBlob, prepareHostedBlob, validateHostedFile } from "./hostedFiles.js";
import { validPrivateVoiceNote } from "./crypto/privateMessaging.js";

it("accepts hour-long podcasts and videos and uses only the original File slices", async () => {
  validateHostedFile("audio/mpeg", 500_000_000, 3_600_000);
  validateHostedFile("video/mp4", HOSTED_FILE_MAX_BYTES, 7_200_000);
  expect(() => validateHostedFile("video/mp4", HOSTED_FILE_MAX_BYTES + 1, 1)).toThrow("2 GiB");
  const file = new Blob([new Uint8Array(MEDIA_UPLOAD_PART_BYTES + 9).fill(71)]);
  file.arrayBuffer = async () => { throw Error("Must not copy the complete file"); };
  const prepared = await prepareHostedBlob(file, false);
  expect(prepared.blob).toBe(file);
  const original = new Uint8Array(await Blob.prototype.arrayBuffer.call(file));
  expect(prepared.digest).toEqual(contentHash(original));
});

it("encrypts multiple chunks and authenticates ciphertext before releasing a playable blob", async () => {
  const source = new Uint8Array(MEDIA_UPLOAD_PART_BYTES + 73).map((_, i) => i % 251);
  const stored = await prepareHostedBlob(new Blob([source]), true);
  expect(stored.blob.size).toBe(source.length + 20 + 32);
  const decoded = await openHostedBlob(new Response(stored.blob), stored.digest, stored.blob.size, "audio/mpeg", stored.encryption);
  expect(Buffer.from(await decoded.arrayBuffer()).equals(Buffer.from(source))).toBe(true);
  const corrupted = new Uint8Array(await stored.blob.arrayBuffer()); corrupted[30] = corrupted[30]! ^ 1;
  await expect(openHostedBlob(new Response(corrupted), contentHash(corrupted), corrupted.length, "audio/mpeg", stored.encryption)).rejects.toThrow();
  await expect(openHostedBlob(new Response(stored.blob.slice(0, -1)), stored.digest, stored.blob.size, "audio/mpeg", stored.encryption)).rejects.toThrow("incomplete");
  await expect(openHostedBlob(new Response(stored.blob), new Uint8Array(32), stored.blob.size, "audio/mpeg", stored.encryption)).rejects.toThrow("fingerprint");
});

it("keeps recording references small, scoped to a safe URL and bound to the committed fingerprint", async () => {
  const digest = contentHash(new Uint8Array([1, 2, 3]));
  const url = `https://media.example/osp/network/identity/${toBase64url(digest)}`;
  const location = hostedFileLocation(url, digest);
  expect(location.length).toBeLessThanOrEqual(256);
  expect(hostedFileUrl(location, digest)).toBe(url);
  expect(() => hostedFileUrl(location, new Uint8Array(32))).toThrow();
  expect(() => hostedFileLocation(url.replace("https:", "http:"), digest)).toThrow();
  expect(() => hostedFileLocation(`${url}?key=secret`, digest)).toThrow();
  const note = { url: location, mime: "audio/mpeg", size: 500_000_000, durationMs: 3_600_000, digest: toBase64url(digest), key: toBase64url(new Uint8Array(32)), nonce: toBase64url(new Uint8Array(24)) };
  expect(validPrivateVoiceNote(note)).toBe(true);
  expect(validPrivateVoiceNote({ ...note, url: location.replace("https:", "http:") })).toBe(false);
});
