import { describe, it, expect } from "vitest";
import { toBase64url, utf8 } from "@osp/sdk";
import type { MediaAttachment } from "../composer/publish";
import { encodeVoiceComment, decodeMusicComment } from "./voiceComment";

const hash = new Uint8Array(32).fill(3);
const voice: MediaAttachment = {
  url: "osp-clip://1P2bThgYcJgj4MCC5AVrcXq5DDj9CRWru/" + toBase64url(hash),
  mime: "audio/webm", size: 120, contentHash: hash, archiveBytes: "never embed uploaded audio",
};
describe("song voice comments", () => {
  it("round trips public and encrypted voice references without copying archive bytes", () => {
    for (const restricted of [true, false]) {
      const clip = { ...voice, ...(restricted && { encryption: { key: toBase64url(hash), nonce: toBase64url(new Uint8Array(24)) } }) };
      const bytes = encodeVoiceComment("A reply", clip);
      expect(decodeMusicComment(bytes, restricted)).toEqual({ text: "A reply", voice: { ...clip, archiveBytes: undefined } });
      expect(decodeMusicComment.bind(null, bytes, !restricted)).toThrow();
      expect(new TextDecoder().decode(bytes)).not.toContain(voice.archiveBytes);
    }
  });
  it("keeps literal legacy text, rejects malformed descriptors, and limits UTF-8 by bytes", () => {
    expect(decodeMusicComment(utf8('{"url":"https://example.org","body":"hello"}'), false).voice).toBeUndefined();
    expect(() => decodeMusicComment(encodeVoiceComment("", {...voice, url:"https://other.host/track"}), false)).toThrow();
    expect(() => encodeVoiceComment("😀".repeat(1200),voice)).toThrow();
  });
});
