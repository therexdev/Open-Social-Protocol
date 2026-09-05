/**
 * Generates the golden vectors in ../vectors from deterministic inputs.
 * Run: npm run vectors -w packages/sdk
 *
 * Every random value the protocol draws (content keys, nonces, ephemeral keys) is fixed here
 * and written into the vectors, so independent implementations can reproduce every output.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  AUDIENCE,
  OUTCOME,
  addressToBytes,
  buildAad,
  buildKeyPackageSet,
  buildProofManifest,
  concat,
  contentHash,
  customAudienceId,
  decodeAad,
  deriveEncryptionKeyPair,
  encodeContent,
  encodeProofManifest,
  encryptContent,
  identityFromSeed,
  idempotencyKey,
  manifestHash,
  manifestSigningHash,
  newCrossPostRecord,
  postId,
  sealEpochKey,
  signProofManifest,
  toHex,
  transition,
  u32be,
  utf8,
  type AadInput,
  type Content,
  type CrossPostRecord,
  type ReconcileEvent,
  type Rng,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "vectors");
mkdirSync(outDir, { recursive: true });

const CHAIN_ID = "EiBncD4pKRIQWco_WRqo5Q-xnXR7JuO3PtZv983mKdKHSQ==";

function rngFor(label: string): Rng {
  let counter = 0;
  return (length: number) => {
    const out = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const block = sha256(concat(utf8(`osp-vectors/${label}`), u32be(counter++)));
      const n = Math.min(block.length, length - offset);
      out.set(block.subarray(0, n), offset);
      offset += n;
    }
    return out;
  };
}

const hex = toHex;
const fill = (n: number, v: number) => new Uint8Array(n).fill(v);

const authorSeed = fill(32, 0x01);
const aliceSeed = fill(32, 0x02);
const bobSeed = fill(32, 0x03);
const author = identityFromSeed(authorSeed, 1);
const alice = identityFromSeed(aliceSeed, 1);
const bob = { ...identityFromSeed(bobSeed, 2), encryption: deriveEncryptionKeyPair(bobSeed, 2) };

function write(name: string, value: unknown): void {
  writeFileSync(join(outDir, name), JSON.stringify(value, null, 2) + "\n");
  console.log(`wrote vectors/${name}`);
}

// ---------------------------------------------------------------------------
// keys.json: seed -> signer address and encryption keys
// ---------------------------------------------------------------------------
write("keys.json", {
  description: "identity derivation: Signer.fromSeed(hex(seed)) and HKDF-SHA256(seed, salt=empty, info='osp/v1/enc-key'||u32be(keyVersion), 32)",
  cases: [author, alice, bob].map((id) => ({
    seed: hex(id.seed),
    account: id.account,
    keyVersion: id.encryption.keyVersion,
    encryptionSecret: hex(id.encryption.secretKey),
    encryptionPublicKey: hex(id.encryption.publicKey),
  })),
});

// ---------------------------------------------------------------------------
// envelope.json: suite 0 and suite 1 envelopes with fixed keys and nonces
// ---------------------------------------------------------------------------
const content: Content = {
  version: 1,
  text: "Hello, friends! éàü 👋",
  mime: "text/plain",
  lang: "en",
  created_at: 1725494400000,
};
const contentWithMedia: Content = {
  ...content,
  text: "Photo",
  media: [
    {
      content_hash: fill(32, 0x77),
      mime: "image/jpeg",
      size: 123456,
      locations: ["ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"],
      wrapped_key: fill(48, 0x78),
      nonce: fill(24, 0x79),
      alt_text: "A photo",
    },
  ],
};

const envRng = rngFor("envelope");
const epochKey = envRng(32);
const envelopeCases = [] as unknown[];

{
  const aad: AadInput = { chainId: CHAIN_ID, author: author.account, audience: AUDIENCE.EVERYONE, epoch: 0, versionNumber: 1 };
  const result = encryptContent({ content, aad });
  envelopeCases.push({
    name: "suite0-everyone-first-version",
    suite: 0,
    content,
    contentBytes: hex(encodeContent(content)),
    aad: { ...aad, aadBytes: hex(buildAad(aad)) },
    envelope: hex(result.bytes),
    contentHash: hex(result.contentHash),
  });
}
{
  const aad: AadInput = { chainId: CHAIN_ID, author: author.account, audience: AUDIENCE.FRIENDS, epoch: 2, versionNumber: 1 };
  const contentKey = envRng(32);
  const nonce = envRng(24);
  const wrapNonce = envRng(24);
  const result = encryptContent({ content, aad, epochKey, contentKey, nonce, wrapNonce });
  envelopeCases.push({
    name: "suite1-friends-first-version",
    suite: 1,
    content,
    contentBytes: hex(encodeContent(content)),
    aad: { ...aad, aadBytes: hex(buildAad(aad)), decoded: hexify(decodeAad(buildAad(aad))) },
    epochKey: hex(epochKey),
    contentKey: hex(contentKey),
    nonce: hex(nonce),
    wrapNonce: hex(wrapNonce),
    envelope: hex(result.bytes),
    envelopeFields: hexify(result.envelope),
    contentHash: hex(result.contentHash),
  });
}
{
  const previousPostId = fill(32, 0x42);
  const audienceId = customAudienceId(author.account, "close-friends");
  const aad: AadInput = { chainId: CHAIN_ID, author: author.account, postId: previousPostId, audience: AUDIENCE.CUSTOM, audienceId, epoch: 7, versionNumber: 2 };
  const contentKey = envRng(32);
  const nonce = envRng(24);
  const wrapNonce = envRng(24);
  const result = encryptContent({ content: contentWithMedia, aad, epochKey, contentKey, nonce, wrapNonce });
  envelopeCases.push({
    name: "suite1-custom-audience-second-version",
    suite: 1,
    content: hexify(contentWithMedia),
    contentBytes: hex(encodeContent(contentWithMedia)),
    aad: { ...aad, postId: hex(previousPostId), audienceId: hex(audienceId), aadBytes: hex(buildAad(aad)) },
    epochKey: hex(epochKey),
    contentKey: hex(contentKey),
    nonce: hex(nonce),
    wrapNonce: hex(wrapNonce),
    envelope: hex(result.bytes),
    envelopeFields: hexify(result.envelope),
    contentHash: hex(result.contentHash),
  });
}
write("envelope.json", {
  description: "spec 5.1: aad = canonical(osp.envelope.aad) with post_id empty for version 1; payload = XChaCha20-Poly1305(contentKey, nonce, canonical(content), aad); wrapped = XChaCha20-Poly1305(epochKey, wrapNonce, contentKey, 'osp/v1/wrap'||aad)",
  chainId: CHAIN_ID,
  cases: envelopeCases,
});

// ---------------------------------------------------------------------------
// ids.json: content hash, post id, idempotency key, audience id
// ---------------------------------------------------------------------------
{
  const suite0 = envelopeCases[0] as { envelope: string };
  const envelopeBytes = Uint8Array.from(Buffer.from(suite0.envelope, "hex"));
  const ch = contentHash(envelopeBytes);
  const attemptId = Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i);
  write("ids.json", {
    description: "spec 2.1-2.3 identifiers",
    chainId: CHAIN_ID,
    protocolVersion: 1,
    author: author.account,
    authorBytes: hex(addressToBytes(author.account)),
    postId: {
      envelope: suite0.envelope,
      contentHash: hex(ch),
      sequence: "1",
      postId: hex(postId({ chainId: CHAIN_ID, author: author.account, sequence: 1, contentHash: ch })),
      sequence2: "18446744073709551615",
      postId2: hex(postId({ chainId: CHAIN_ID, author: author.account, sequence: "18446744073709551615", contentHash: ch })),
    },
    idempotency: { attemptId: hex(attemptId), key: hex(idempotencyKey(author.account, attemptId)) },
    audience: { label: "close-friends", audienceId: hex(customAudienceId(author.account, "close-friends")) },
  });
}

// ---------------------------------------------------------------------------
// sealed-keys.json: epoch key sealed to author, alice and bob
// ---------------------------------------------------------------------------
{
  const sealRng = rngFor("seal");
  const audienceId = customAudienceId(author.account, "close-friends");
  const context = { author: author.account, audienceId, epoch: 7 };
  const recipients = [author, alice, bob].map((id) => ({
    address: id.account,
    publicKey: id.encryption.publicKey,
    secretKey: id.encryption.secretKey,
    keyVersion: id.encryption.keyVersion,
    ephemeralSecretKey: sealRng(32),
    nonce: sealRng(24),
  }));
  const sealed = recipients.map((r) =>
    sealEpochKey({
      ...context,
      epochKey,
      recipient: r.address,
      recipientPublicKey: r.publicKey,
      recipientKeyVersion: r.keyVersion,
      ephemeralSecretKey: r.ephemeralSecretKey,
      nonce: r.nonce,
    }),
  );
  // The key package set uses the same deterministic draws (ephemeral secret then nonce per recipient).
  const pkg = buildKeyPackageSet({ ...context, epochKey, recipients, rng: rngFor("seal") });
  write("sealed-keys.json", {
    description: "spec 5.2: seal_key = HKDF-SHA256(x25519(eph, pub), salt=eph.pub||pub, info='osp/v1/seal', 32); ciphertext = XChaCha20-Poly1305(seal_key, nonce, epochKey, aad = author||audience_id||u32be(epoch)||recipient)",
    author: author.account,
    audienceId: hex(audienceId),
    epoch: 7,
    epochKey: hex(epochKey),
    recipients: recipients.map((r, i) => ({
      address: r.address,
      keyVersion: r.keyVersion,
      secretKey: hex(r.secretKey),
      publicKey: hex(r.publicKey),
      ephemeralSecretKey: hex(r.ephemeralSecretKey),
      nonce: hex(r.nonce),
      sealed: hexify(sealed[i]),
    })),
    keyPackageSet: hex(pkg.bytes),
  });
}

// ---------------------------------------------------------------------------
// manifest.json: signed proof manifest
// ---------------------------------------------------------------------------
{
  const manifest = buildProofManifest({
    author: author.account,
    post_id: fill(32, 0x42),
    content_hash: fill(32, 0x43),
    version_number: 1,
    transaction_id: "0x1220" + "44".repeat(32),
    block_height: 123456,
    audience: AUDIENCE.FRIENDS,
    epoch: 2,
    storage_refs: ["ipfs://bafy-a", "https://mirror.example/b"],
    adapter: "facebook",
    external_ref: "https://www.facebook.com/user/posts/1",
    outcome: OUTCOME.SUCCEEDED,
    idempotency_key: idempotencyKey(author.account, Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i)),
    created_at: 1725494400000,
  });
  const signed = await signProofManifest(manifest, author.signer);
  write("manifest.json", {
    description: "spec 8: signature = secp256k1(sha256('osp/v1/manifest' || canonical(manifest with signature/signer empty))); manifest_hash = sha256(canonical(signed manifest))",
    signerSeed: hex(author.seed),
    signer: author.account,
    manifest: hexify(manifest),
    unsignedBytes: hex(encodeProofManifest(manifest)),
    signingHash: hex(manifestSigningHash(manifest)),
    signature: hex(signed.signature),
    signedBytes: hex(encodeProofManifest(signed)),
    manifestHash: hex(manifestHash(signed)),
  });
}

// ---------------------------------------------------------------------------
// reconcile.json: transition table
// ---------------------------------------------------------------------------
{
  const start = (hostSite?: string) =>
    newCrossPostRecord({ idempotencyKey: fill(16, 0xa1), attemptId: fill(16, 0xa2), hostSite, audience: 1, now: 1000 });
  const post = "cc".repeat(32);
  const cases: Array<{ name: string; hostSite?: string; events: ReconcileEvent[] }> = [
    { name: "both succeed", hostSite: "facebook", events: [{ type: "retry" }, { type: "hostSucceeded", hostRef: "fb:1" }, { type: "koinosSucceeded", txId: "0x1220aa", postId: post }] },
    { name: "host ok koinos failed -> partial -> retry koinos only", hostSite: "facebook", events: [{ type: "retry" }, { type: "hostSucceeded", hostRef: "fb:1" }, { type: "koinosFailed", error: "insufficient rc" }, { type: "retry" }] },
    { name: "koinos ok host failed -> partial (postId kept)", hostSite: "facebook", events: [{ type: "retry" }, { type: "koinosSucceeded", txId: "0x1220aa", postId: post }, { type: "hostFailed", error: "http 500" }, { type: "retry" }] },
    { name: "koinos unknown blocks retry", hostSite: "facebook", events: [{ type: "retry" }, { type: "koinosUnknown", error: "timeout" }, { type: "retry" }] },
    { name: "koinos unknown -> lookupFound -> host ok -> succeeded", hostSite: "facebook", events: [{ type: "retry" }, { type: "koinosUnknown" }, { type: "lookupFound", postId: post, txId: "0x1220bb" }, { type: "hostSucceeded", hostRef: "fb:2" }] },
    { name: "koinos unknown -> lookupMissing -> retryable", hostSite: "facebook", events: [{ type: "retry" }, { type: "koinosUnknown" }, { type: "lookupMissing" }] },
    { name: "both failed -> failed -> retry", hostSite: "facebook", events: [{ type: "retry" }, { type: "hostFailed", error: "a" }, { type: "koinosFailed", error: "b" }, { type: "retry" }] },
    { name: "conflicting post id -> reconcile_required", hostSite: "facebook", events: [{ type: "retry" }, { type: "koinosSucceeded", txId: "0x1", postId: post }, { type: "lookupFound", postId: "dd".repeat(32) }, { type: "retry" }] },
    { name: "lookupMissing after success -> reconcile_required", hostSite: "facebook", events: [{ type: "retry" }, { type: "koinosSucceeded", txId: "0x1", postId: post }, { type: "lookupMissing" }] },
    { name: "koinos-only succeeds", events: [{ type: "retry" }, { type: "koinosSucceeded", txId: "0x1", postId: post }] },
    { name: "duplicate success is a no-op", hostSite: "facebook", events: [{ type: "retry" }, { type: "koinosSucceeded", txId: "0x1", postId: post }, { type: "koinosSucceeded", txId: "0x1", postId: post }, { type: "hostSucceeded", hostRef: "fb:1" }, { type: "hostSucceeded", hostRef: "fb:1" }, { type: "retry" }] },
  ];
  const vectors = cases.map((c) => {
    const steps: Array<{ event: ReconcileEvent; state: string }> = [];
    let record: CrossPostRecord = start(c.hostSite);
    c.events.forEach((event, i) => {
      record = transition(record, { ...event, at: 2000 + i });
      steps.push({ event: { ...event, at: 2000 + i }, state: record.state });
    });
    return { name: c.name, start: start(c.hostSite), steps, final: record };
  });
  write("reconcile.json", { description: "spec 7 transition table (states after each event and the final record)", cases: vectors });
}

/** Replaces Uint8Array values by hex strings and bigints by strings, recursively. */
function hexify(value: unknown): unknown {
  if (value instanceof Uint8Array) return hex(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(hexify);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = hexify(v);
    return out;
  }
  return value;
}
