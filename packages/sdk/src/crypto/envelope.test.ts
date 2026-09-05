import { describe, expect, it } from "vitest";
import { Signer } from "koilib";
import { AUDIENCE, LIMITS, SUITE } from "../constants.js";
import {
  buildAad,
  decodeAad,
  decodeEnvelope,
  decryptContent,
  encodeContent,
  encodeEnvelope,
  encryptContent,
  EnvelopeError,
  unwrapContentKey,
  validateContent,
  validateEnvelopeSize,
  type AadInput,
} from "./envelope.js";
import { newEpochKey } from "./audience.js";
import { contentHash } from "../ids.js";
import { deterministicRng, HARBINGER_CHAIN_ID } from "../testing/fixtures.js";

const author = Signer.fromSeed("author").getAddress();
const aad: AadInput = { chainId: HARBINGER_CHAIN_ID, author, audience: AUDIENCE.FRIENDS, epoch: 3, versionNumber: 1 };
const content = { version: 1, text: "hello friends", mime: "text/plain", created_at: 1700000000000 };

describe("envelope", () => {
  it("suite 1 round trip", () => {
    const rng = deterministicRng("envelope");
    const epochKey = newEpochKey(rng);
    const result = encryptContent({ content, aad, epochKey, rng });
    expect(result.envelope.suite).toBe(SUITE.XCHACHA20POLY1305_X25519);
    expect(result.envelope.nonce?.length).toBe(LIMITS.nonceBytes);
    expect(result.contentHash).toEqual(contentHash(result.bytes));
    expect(result.bytes.length).toBeLessThan(LIMITS.maxEnvelopeBytes);
    const decoded = decodeEnvelope(result.bytes);
    expect(encodeEnvelope(decoded)).toEqual(result.bytes);
    const plaintext = decryptContent({ envelope: result.bytes, aad, epochKey });
    expect(plaintext.text).toBe(content.text);
    expect(plaintext.created_at).toBe("1700000000000");
    expect(unwrapContentKey(decoded, epochKey, aad)).toEqual(result.contentKey);
  });

  it("wrong epoch key fails", () => {
    const rng = deterministicRng("envelope-2");
    const epochKey = newEpochKey(rng);
    const result = encryptContent({ content, aad, epochKey, rng });
    expect(() => decryptContent({ envelope: result.bytes, aad, epochKey: newEpochKey(rng) })).toThrow(EnvelopeError);
  });

  it("AAD tamper fails (epoch, author, version number)", () => {
    const rng = deterministicRng("envelope-3");
    const epochKey = newEpochKey(rng);
    const result = encryptContent({ content, aad, epochKey, rng });
    expect(() => decryptContent({ envelope: result.bytes, aad: { ...aad, epoch: 4 }, epochKey })).toThrow(EnvelopeError);
    expect(() => decryptContent({ envelope: result.bytes, aad: { ...aad, author: Signer.fromSeed("other").getAddress() }, epochKey })).toThrow(EnvelopeError);
    expect(() => decryptContent({ envelope: result.bytes, aad: { ...aad, versionNumber: 2, postId: new Uint8Array(32) }, epochKey })).toThrow(EnvelopeError);
  });

  it("ciphertext tamper fails", () => {
    const rng = deterministicRng("envelope-4");
    const epochKey = newEpochKey(rng);
    const result = encryptContent({ content, aad, epochKey, rng });
    const env = decodeEnvelope(result.bytes);
    const tamperedPayload = { ...env, payload: env.payload.map((b, i) => (i === 0 ? b ^ 1 : b)) };
    expect(() => decryptContent({ envelope: tamperedPayload, aad, epochKey })).toThrow(/authentication failed/);
    const tamperedWrap = { ...env, wrapped_content_key: env.wrapped_content_key.map((b, i) => (i === 3 ? b ^ 1 : b)) };
    expect(() => decryptContent({ envelope: tamperedWrap, aad, epochKey })).toThrow(/unwrap failed/);
  });

  it("first version AAD carries an empty post_id, later versions the real one", () => {
    const first = decodeAad(buildAad({ ...aad, postId: new Uint8Array(32).fill(7), versionNumber: 1 }));
    expect(first.post_id.length).toBe(0);
    const second = decodeAad(buildAad({ ...aad, postId: new Uint8Array(32).fill(7), versionNumber: 2 }));
    expect(second.post_id).toEqual(new Uint8Array(32).fill(7));
    expect(second.audience).toBe(AUDIENCE.FRIENDS);
    expect(() => buildAad({ ...aad, versionNumber: 2 })).toThrow(/postId/);
  });

  it("suite 0 stores the content in the clear and only for everyone", () => {
    const result = encryptContent({ content, aad: { ...aad, audience: AUDIENCE.EVERYONE } });
    expect(result.envelope.suite).toBe(SUITE.PLAINTEXT);
    expect(result.contentKey).toBeUndefined();
    expect(decryptContent({ envelope: result.bytes }).text).toBe(content.text);
    expect(() => encryptContent({ content, aad, suite: SUITE.PLAINTEXT })).toThrow(/everyone/);
    expect(() => encryptContent({ content, aad })).toThrow(/plaintext|everyone/);
  });

  it("enforces the pilot size limits before anything is published", () => {
    const rng = deterministicRng("envelope-limits");
    const epochKey = newEpochKey(rng);
    const everyone = { ...aad, audience: AUDIENCE.EVERYONE };
    // envelope bytes (both suites)
    const big = { version: 1, text: "x".repeat(LIMITS.maxEnvelopeBytes + 1) };
    expect(() => encryptContent({ content: big, aad: everyone })).toThrow(/above the limit of 4096/);
    expect(() => encryptContent({ content: big, aad, epochKey, rng })).toThrow(EnvelopeError);
    // just under the limit still works (suite 1 adds nonce/wrapped key/tag overhead)
    const ok = encryptContent({ content: { version: 1, text: "x".repeat(3900) }, aad, epochKey, rng });
    expect(ok.bytes.length).toBeLessThanOrEqual(LIMITS.maxEnvelopeBytes);
    expect(() => validateEnvelopeSize(new Uint8Array(LIMITS.maxEnvelopeBytes))).not.toThrow();
    expect(() => validateEnvelopeSize(new Uint8Array(LIMITS.maxEnvelopeBytes + 1))).toThrow(EnvelopeError);
    // media refs
    const media = (n: number) => Array.from({ length: n }, () => ({ mime: "image/png", locations: ["https://m.example/a"] }));
    expect(() => validateContent({ media: media(LIMITS.maxMediaRefs) })).not.toThrow();
    expect(() => validateContent({ media: media(LIMITS.maxMediaRefs + 1) })).toThrow(/media refs/);
    expect(() => encryptContent({ content: { media: media(9) }, aad: everyone })).toThrow(EnvelopeError);
    // locations per ref
    const locations = (n: number) => Array.from({ length: n }, (_, i) => `https://m.example/${i}`);
    expect(() => validateContent({ media: [{ locations: locations(LIMITS.maxLocationsPerRef) }] })).not.toThrow();
    expect(() => validateContent({ media: [{ locations: locations(LIMITS.maxLocationsPerRef + 1) }] })).toThrow(/locations/);
    expect(() => encodeContent({ media: [{ locations: locations(5) }] })).toThrow(EnvelopeError);
    // location length
    expect(() => validateContent({ media: [{ locations: ["h".repeat(LIMITS.maxLocationChars)] }] })).not.toThrow();
    expect(() => validateContent({ media: [{ locations: ["h".repeat(LIMITS.maxLocationChars + 1)] }] })).toThrow(/chars/);
    expect(() => encryptContent({ content: { media: [{ locations: ["h".repeat(257)] }] }, aad, epochKey, rng })).toThrow(EnvelopeError);
  });
});
