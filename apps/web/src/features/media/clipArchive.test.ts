import { expect, it } from "vitest";
import { contentHash, fromBase64url, openMedia, parseClipLocation, toBase64url, voiceStorageUnits, type ProtocolClient } from "@osp/sdk";
import { prepareClip } from "./clipArchive";

const contract = "1P2bThgYcJgj4MCC5AVrcXq5DDj9CRWru";
const client = { deployment: { contracts: { publications: { address: contract } } } } as ProtocolClient;

it("round-trips a private recorder output and binds the reference to its archive", () => {
  const bytes = new Uint8Array(1024).fill(123);
  const voice = prepareClip({ bytes, mime: "audio/webm;codecs=opus", durationMs: 7000 }, "voice", client, true);
  const id = parseClipLocation(voice.url, contract);
  expect(id.length).toBe(32);
  expect(voice.url).toBe(`osp-clip://${contract}/${toBase64url(id)}`);
  expect(() => parseClipLocation(voice.url, "another")).toThrow();
  expect(voice.mime).toBe("audio/webm");
  const encrypted = fromBase64url(voice.archiveBytes!);
  expect(voice.contentHash).toEqual(contentHash(encrypted));
  expect(encrypted).not.toEqual(bytes);
  expect(openMedia(encrypted, voice.contentHash, { key: fromBase64url(voice.encryption!.key), nonce: fromBase64url(voice.encryption!.nonce) })).toEqual(bytes);
  expect(voiceStorageUnits(32768)).toBe(1);
  expect(voiceStorageUnits(32769)).toBe(2);
});

it("preserves original video bytes and enforces duration and encrypted storage ceilings", () => {
  const bytes = new Uint8Array(10 * 1024 * 1024).fill(7);
  const input = { bytes, mime: "video/mp4", durationMs: 30000 };
  const video = prepareClip(input, "video", client, false);
  expect(video.size).toBe(bytes.length);
  expect(toBase64url(contentHash(fromBase64url(video.archiveBytes!)))).toBe(toBase64url(contentHash(bytes)));
  expect(() => prepareClip(input, "video", client, true)).toThrow("10 MiB");
  expect(() => prepareClip({ ...input, durationMs: 9999 }, "video", client, false)).toThrow("10 and 30");
  expect(() => prepareClip({ ...input, durationMs: 30001 }, "video", client, false)).toThrow("10 and 30");
});
