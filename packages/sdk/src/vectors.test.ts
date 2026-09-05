/**
 * Conformance: the SDK reproduces every golden vector in ../vectors and rejects tampering.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Signer } from "koilib";
import {
  buildAad,
  buildKeyPackageSet,
  contentHash,
  customAudienceId,
  decodeProofManifest,
  decryptContent,
  deriveEncryptionKeyPair,
  encodeContent,
  encodeProofManifest,
  encryptContent,
  fromHex,
  idempotencyKey,
  manifestHash,
  manifestSigningHash,
  openEpochKey,
  openEpochKeyFromSet,
  parseKeyPackageSet,
  postId,
  sealEpochKey,
  signerFromSeed,
  signProofManifest,
  toHex,
  transition,
  verifyProofManifest,
  type AadInput,
  type Content,
  type CrossPostRecord,
  type ProofManifest,
  type ReconcileEvent,
  type SealedKey,
} from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = <T>(name: string): T => JSON.parse(readFileSync(join(here, "..", "vectors", name), "utf8")) as T;

const unhexify = (value: unknown, bytesKeys: Set<string>): unknown => {
  if (Array.isArray(value)) return value.map((v) => unhexify(v, bytesKeys));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = bytesKeys.has(k) && typeof v === "string" ? fromHex(v) : unhexify(v, bytesKeys);
    }
    return out;
  }
  return value;
};

interface KeysVectors {
  cases: Array<{ seed: string; account: string; keyVersion: number; encryptionSecret: string; encryptionPublicKey: string }>;
}
interface EnvelopeCase {
  name: string;
  suite: number;
  content: Record<string, unknown>;
  contentBytes: string;
  aad: { chainId: string; author: string; postId?: string; audience: number; audienceId?: string; epoch: number; versionNumber: number; aadBytes: string };
  epochKey?: string;
  contentKey?: string;
  nonce?: string;
  wrapNonce?: string;
  envelope: string;
  contentHash: string;
}
interface IdsVectors {
  chainId: string;
  author: string;
  authorBytes: string;
  postId: { envelope: string; contentHash: string; sequence: string; postId: string; sequence2: string; postId2: string };
  idempotency: { attemptId: string; key: string };
  audience: { label: string; audienceId: string };
}
interface SealedVectors {
  author: string;
  audienceId: string;
  epoch: number;
  epochKey: string;
  recipients: Array<{
    address: string;
    keyVersion: number;
    secretKey: string;
    publicKey: string;
    ephemeralSecretKey: string;
    nonce: string;
    sealed: Record<string, string | number>;
  }>;
  keyPackageSet: string;
}
interface ManifestVectors {
  signerSeed: string;
  signer: string;
  manifest: Record<string, unknown>;
  unsignedBytes: string;
  signingHash: string;
  signature: string;
  signedBytes: string;
  manifestHash: string;
}
interface ReconcileVectors {
  cases: Array<{ name: string; start: CrossPostRecord; steps: Array<{ event: ReconcileEvent; state: string }>; final: CrossPostRecord }>;
}

const CONTENT_BYTES = new Set(["content_hash", "wrapped_key", "nonce"]);
const MANIFEST_BYTES = new Set(["author", "post_id", "content_hash", "transaction_id", "audience_id", "idempotency_key", "signature", "signer"]);
const SEALED_BYTES = new Set(["recipient", "ephemeral_public_key", "nonce", "ciphertext"]);

function aadInput(aad: EnvelopeCase["aad"]): AadInput {
  return {
    chainId: aad.chainId,
    author: aad.author,
    ...(aad.postId && { postId: fromHex(aad.postId) }),
    audience: aad.audience,
    ...(aad.audienceId && { audienceId: fromHex(aad.audienceId) }),
    epoch: aad.epoch,
    versionNumber: aad.versionNumber,
  };
}

describe("golden vectors", () => {
  it("keys.json", () => {
    for (const c of load<KeysVectors>("keys.json").cases) {
      const seed = fromHex(c.seed);
      expect(signerFromSeed(seed).getAddress()).toBe(c.account);
      const pair = deriveEncryptionKeyPair(seed, c.keyVersion);
      expect(toHex(pair.secretKey)).toBe(c.encryptionSecret);
      expect(toHex(pair.publicKey)).toBe(c.encryptionPublicKey);
    }
  });

  it("envelope.json", () => {
    const vectors = load<{ chainId: string; cases: EnvelopeCase[] }>("envelope.json");
    for (const c of vectors.cases) {
      const content = unhexify(c.content, CONTENT_BYTES) as Content;
      expect(toHex(encodeContent(content))).toBe(c.contentBytes);
      const aad = aadInput(c.aad);
      expect(toHex(buildAad(aad))).toBe(c.aad.aadBytes);
      const result = encryptContent({
        content,
        aad,
        suite: c.suite,
        ...(c.epochKey && { epochKey: fromHex(c.epochKey) }),
        ...(c.contentKey && { contentKey: fromHex(c.contentKey) }),
        ...(c.nonce && { nonce: fromHex(c.nonce) }),
        ...(c.wrapNonce && { wrapNonce: fromHex(c.wrapNonce) }),
      });
      expect(toHex(result.bytes), c.name).toBe(c.envelope);
      expect(toHex(result.contentHash), c.name).toBe(c.contentHash);
      expect(toHex(contentHash(fromHex(c.envelope)))).toBe(c.contentHash);
      const epochKey = c.epochKey ? fromHex(c.epochKey) : undefined;
      const decrypted = decryptContent({ envelope: fromHex(c.envelope), aad, ...(epochKey && { epochKey }) });
      expect(decrypted.text).toBe(content.text);
      expect(toHex(encodeContent(decrypted))).toBe(c.contentBytes);
      if (c.suite === 1 && epochKey) {
        const tampered = fromHex(c.envelope);
        tampered[tampered.length - 1] = (tampered[tampered.length - 1] as number) ^ 0x01;
        expect(() => decryptContent({ envelope: tampered, aad, epochKey })).toThrow();
        expect(() => decryptContent({ envelope: fromHex(c.envelope), aad: { ...aad, epoch: aad.epoch + 1 }, epochKey })).toThrow();
        const wrongKey = new Uint8Array(epochKey);
        wrongKey[0] = (wrongKey[0] as number) ^ 0x01;
        expect(() => decryptContent({ envelope: fromHex(c.envelope), aad, epochKey: wrongKey })).toThrow();
      }
    }
  });

  it("ids.json", () => {
    const v = load<IdsVectors>("ids.json");
    const envelope = fromHex(v.postId.envelope);
    const ch = contentHash(envelope);
    expect(toHex(ch)).toBe(v.postId.contentHash);
    expect(toHex(postId({ chainId: v.chainId, author: v.author, sequence: v.postId.sequence, contentHash: ch }))).toBe(v.postId.postId);
    expect(toHex(postId({ chainId: v.chainId, author: fromHex(v.authorBytes), sequence: v.postId.sequence2, contentHash: ch }))).toBe(v.postId.postId2);
    expect(toHex(idempotencyKey(v.author, fromHex(v.idempotency.attemptId)))).toBe(v.idempotency.key);
    expect(toHex(customAudienceId(v.author, v.audience.label))).toBe(v.audience.audienceId);
  });

  it("sealed-keys.json", () => {
    const v = load<SealedVectors>("sealed-keys.json");
    const context = { author: v.author, audienceId: fromHex(v.audienceId), epoch: v.epoch };
    const epochKey = fromHex(v.epochKey);
    for (const r of v.recipients) {
      const expected = unhexify(r.sealed, SEALED_BYTES) as SealedKey;
      const sealed = sealEpochKey({
        ...context,
        epochKey,
        recipient: r.address,
        recipientPublicKey: fromHex(r.publicKey),
        recipientKeyVersion: r.keyVersion,
        ephemeralSecretKey: fromHex(r.ephemeralSecretKey),
        nonce: fromHex(r.nonce),
      });
      expect(sealed).toEqual(expected);
      expect(openEpochKey({ ...context, sealed: expected, recipientSecretKey: fromHex(r.secretKey) })).toEqual(epochKey);
      const other = v.recipients.find((x) => x.address !== r.address)!;
      expect(() => openEpochKey({ ...context, sealed: expected, recipientSecretKey: fromHex(other.secretKey) })).toThrow();
      const tampered = { ...expected, ciphertext: expected.ciphertext.map((b, i) => (i === 0 ? b ^ 1 : b)) };
      expect(() => openEpochKey({ ...context, sealed: tampered, recipientSecretKey: fromHex(r.secretKey) })).toThrow();
    }
    const set = parseKeyPackageSet(fromHex(v.keyPackageSet));
    expect(set.keys.length).toBe(v.recipients.length);
    for (const r of v.recipients) {
      expect(openEpochKeyFromSet(set, r.address, fromHex(r.secretKey))).toEqual(epochKey);
    }
    // rebuild with the same deterministic draws
    let i = 0;
    const draws = v.recipients.flatMap((r) => [fromHex(r.ephemeralSecretKey), fromHex(r.nonce)]);
    const rng = () => draws[i++]!;
    const rebuilt = buildKeyPackageSet({
      ...context,
      epochKey,
      recipients: v.recipients.map((r) => ({ address: r.address, publicKey: fromHex(r.publicKey), keyVersion: r.keyVersion })),
      rng,
    });
    expect(toHex(rebuilt.bytes)).toBe(v.keyPackageSet);
  });

  it("manifest.json", async () => {
    const v = load<ManifestVectors>("manifest.json");
    const manifest = unhexify(v.manifest, MANIFEST_BYTES) as ProofManifest;
    expect(toHex(encodeProofManifest(manifest))).toBe(v.unsignedBytes);
    expect(toHex(manifestSigningHash(manifest))).toBe(v.signingHash);
    const signer = signerFromSeed(fromHex(v.signerSeed));
    expect(signer.getAddress()).toBe(v.signer);
    const signed = await signProofManifest(manifest, signer);
    expect(toHex(signed.signature)).toBe(v.signature);
    expect(toHex(encodeProofManifest(signed))).toBe(v.signedBytes);
    expect(toHex(manifestHash(signed))).toBe(v.manifestHash);
    const parsed = decodeProofManifest(fromHex(v.signedBytes));
    expect(verifyProofManifest(parsed)).toEqual({ valid: true, signer: v.signer });
    expect(Signer.recoverAddress(fromHex(v.signingHash), fromHex(v.signature))).toBe(v.signer);
    expect(verifyProofManifest({ ...parsed, external_ref: parsed.external_ref + "x" }).valid).toBe(false);
    const flipped = new Uint8Array(parsed.signature);
    flipped[20] = (flipped[20] as number) ^ 0x01;
    expect(verifyProofManifest({ ...parsed, signature: flipped }).valid).toBe(false);
  });

  it("reconcile.json", () => {
    for (const c of load<ReconcileVectors>("reconcile.json").cases) {
      let record = c.start;
      for (const step of c.steps) {
        record = transition(record, step.event);
        expect(record.state, `${c.name}: after ${step.event.type}`).toBe(step.state);
      }
      expect(record, c.name).toEqual(c.final);
    }
  });
});
