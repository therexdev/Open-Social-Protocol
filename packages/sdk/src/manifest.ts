/**
 * Proof manifests (spec section 8).
 *
 * signature     = secp256k1(sha256("osp/v1/manifest" || canonical(manifest with signature, signer empty)))
 * manifest_hash = sha256(canonical(manifest including signature))
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { Signer } from "koilib";
import type { SignerInterface } from "koilib";
import { DOMAIN, MANIFEST_VERSION } from "./constants.js";
import { bytesEqual, concat, decode, encode, fromBase58, utf8 } from "./encoding.js";
import { addressToBytes, addressToString, type AddressLike } from "./ids.js";

export class ManifestError extends Error {
  override name = "ManifestError";
}

/** osp.envelope.proof_manifest (SDK object model). */
export interface ProofManifest {
  version: number;
  author: Uint8Array;
  post_id: Uint8Array;
  content_hash: Uint8Array;
  version_number: number;
  transaction_id: Uint8Array;
  block_height: string;
  audience: number;
  audience_id: Uint8Array;
  epoch: number;
  storage_refs: string[];
  adapter: string;
  external_ref: string;
  outcome: number;
  idempotency_key: Uint8Array;
  created_at: string;
  signature: Uint8Array;
  signer: Uint8Array;
}

export interface ProofManifestInput {
  author: AddressLike;
  post_id: Uint8Array;
  content_hash: Uint8Array;
  version_number: number;
  /** Koinos transaction id: `0x1220...` hex multihash string or raw bytes. */
  transaction_id: string | Uint8Array;
  block_height: string | number | bigint;
  audience: number;
  audience_id?: Uint8Array;
  epoch?: number;
  storage_refs?: string[];
  adapter: string;
  external_ref?: string;
  /** publications.outcome_state */
  outcome: number;
  idempotency_key: Uint8Array;
  /** ms since epoch; defaults to now. */
  created_at?: string | number | bigint;
}

const MANIFEST_TYPE = "osp.envelope.proof_manifest";

function transactionIdBytes(id: string | Uint8Array): Uint8Array {
  if (id instanceof Uint8Array) return id;
  const hex = id.startsWith("0x") ? id.slice(2) : id;
  if (hex.length === 0) return new Uint8Array(0);
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) throw new ManifestError("transaction id must be hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Builds an unsigned manifest (signature and signer empty). */
export function buildProofManifest(input: ProofManifestInput): ProofManifest {
  return {
    version: MANIFEST_VERSION,
    author: addressToBytes(input.author),
    post_id: input.post_id,
    content_hash: input.content_hash,
    version_number: input.version_number,
    transaction_id: transactionIdBytes(input.transaction_id),
    block_height: BigInt(input.block_height).toString(),
    audience: input.audience,
    audience_id: input.audience_id ?? new Uint8Array(0),
    epoch: input.epoch ?? 0,
    storage_refs: input.storage_refs ?? [],
    adapter: input.adapter,
    external_ref: input.external_ref ?? "",
    outcome: input.outcome,
    idempotency_key: input.idempotency_key,
    created_at: BigInt(input.created_at ?? Date.now()).toString(),
    signature: new Uint8Array(0),
    signer: new Uint8Array(0),
  };
}

/** Canonical bytes of a manifest (with whatever signature/signer it carries). */
export function encodeProofManifest(manifest: ProofManifest): Uint8Array {
  return encode(MANIFEST_TYPE, manifest as unknown as Record<string, unknown>);
}

export function decodeProofManifest(bytes: Uint8Array): ProofManifest {
  return decode<ProofManifest>(MANIFEST_TYPE, bytes);
}

/** The hash that is signed: sha256("osp/v1/manifest" || canonical bytes with signature/signer empty). */
export function manifestSigningHash(manifest: ProofManifest): Uint8Array {
  const unsigned: ProofManifest = { ...manifest, signature: new Uint8Array(0), signer: new Uint8Array(0) };
  return sha256(concat(utf8(DOMAIN.MANIFEST), encodeProofManifest(unsigned)));
}

/** Signs a manifest with the author's (or an authorized device's) key; fills `signature` and `signer`. */
export async function signProofManifest(manifest: ProofManifest, signer: SignerInterface): Promise<ProofManifest> {
  const signature = await signer.signHash(manifestSigningHash(manifest));
  return { ...manifest, signature, signer: fromBase58(signer.getAddress()) };
}

export interface ManifestVerification {
  valid: boolean;
  /** Address recovered from the signature (Base58), when recoverable. */
  signer?: string;
  reason?: string;
}

/**
 * Verifies the signature: the recovered address must equal `manifest.signer` and, when
 * `expectedSigners` is given, be one of them (author or an authorized device).
 */
export function verifyProofManifest(manifest: ProofManifest, expectedSigners?: AddressLike[]): ManifestVerification {
  if (manifest.signature.length === 0 || manifest.signer.length === 0) return { valid: false, reason: "unsigned" };
  let recovered: string;
  try {
    recovered = Signer.recoverAddress(manifestSigningHash(manifest), manifest.signature);
  } catch {
    return { valid: false, reason: "signature not recoverable" };
  }
  if (!bytesEqual(fromBase58(recovered), manifest.signer)) return { valid: false, signer: recovered, reason: "signer mismatch" };
  if (expectedSigners && !expectedSigners.some((s) => addressToString(s) === recovered)) {
    return { valid: false, signer: recovered, reason: "signer not expected" };
  }
  return { valid: true, signer: recovered };
}

/** `manifest_hash = sha256(canonical manifest bytes including signature)` for `record_cross_post`. */
export function manifestHash(manifest: ProofManifest | Uint8Array): Uint8Array {
  return sha256(manifest instanceof Uint8Array ? manifest : encodeProofManifest(manifest));
}
