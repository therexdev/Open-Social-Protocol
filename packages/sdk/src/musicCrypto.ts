import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesEqual, concat, fromBase64url, utf8 } from "./encoding.js";
import { addressToBytes, contentHash } from "./ids.js";
import {
  openEpochKey,
  sealEpochKey,
  type AudienceContext,
  type Recipient,
} from "./crypto/audience.js";
import { deriveEncryptionSecret } from "./crypto/keys.js";
import type { MusicKey } from "./music.js";

/** Keys and ciphertext are bound to this chain, contract and immutable track id. */
export function musicKeyContext(
  chainId: string,
  contract: string,
  id: Uint8Array,
  owner: string
): AudienceContext {
  if (id.length !== 32) throw new Error("Invalid track id.");
  return {
    author: owner,
    audienceId: contentHash(
      concat(utf8("osp/music/key/v2"), fromBase64url(chainId), addressToBytes(contract), id)
    ),
    epoch: 1,
  };
}
export function sealMusicKey(
  context: AudienceContext,
  key: Uint8Array,
  recipient: Recipient
): MusicKey {
  const value = sealEpochKey({
    ...context,
    epochKey: key,
    recipient: recipient.address,
    recipientPublicKey: recipient.publicKey,
    recipientKeyVersion: recipient.keyVersion,
  });
  return {
    key_version: value.recipient_key_version,
    ephemeral_public_key: value.ephemeral_public_key,
    nonce: value.nonce,
    ciphertext: value.ciphertext,
  };
}
export function openMusicKey(
  context: AudienceContext,
  key: MusicKey,
  account: string,
  seed: Uint8Array,
  expectedHash: Uint8Array
): Uint8Array {
  const secret = deriveEncryptionSecret(seed, key.key_version);
  try {
    const value = openEpochKey({
      ...context,
      sealed: {
        recipient: addressToBytes(account),
        recipient_key_version: key.key_version,
        ephemeral_public_key: key.ephemeral_public_key,
        nonce: key.nonce,
        ciphertext: key.ciphertext,
      },
      recipientSecretKey: secret,
    });
    if (!bytesEqual(contentHash(value), expectedHash)) {
      value.fill(0);
      throw new Error("Delivered key does not match this track.");
    }
    return value;
  } finally {
    secret.fill(0);
  }
}
export function musicCipher(context: AudienceContext, key: Uint8Array, nonce: Uint8Array) {
  return xchacha20poly1305(key, nonce, concat(utf8("osp/music/audio/v2"), context.audienceId!));
}
export function musicCoverCipher(context: AudienceContext, key: Uint8Array, nonce: Uint8Array) {
  return xchacha20poly1305(key, nonce, concat(utf8("osp/music/cover/v1"), context.audienceId!));
}
export function musicCommentCipher(
  context: AudienceContext,
  key: Uint8Array,
  nonce: Uint8Array,
  id: Uint8Array,
  author: string
) {
  return xchacha20poly1305(
    key,
    nonce,
    concat(utf8("osp/music/comment/v2"), context.audienceId!, id, addressToBytes(author))
  );
}
