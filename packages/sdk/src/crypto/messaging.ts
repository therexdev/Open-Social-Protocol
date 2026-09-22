/** Consent lives on chain. Every envelope binds its deployment, parties, id and generation. */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesEqual, canonicalJson, decode, encode, toBase64url, utf8, utf8Decode } from "../encoding.js";
import { addressToBytes } from "../ids.js";
import { randomBytes, type Rng } from "./keys.js";
import { openEpochKey, sealEpochKey, type Recipient, type SealedKey } from "./audience.js";

export interface DirectMessageContext {
  chainId: string;
  contract: string;
  sender: string;
  recipient: string;
  messageId: Uint8Array;
  generation: string;
}
interface MessageEnvelope {
  version: number;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  keys: SealedKey[];
}
function aad(c: DirectMessageContext): Uint8Array {
  if (c.messageId.length !== 32 || !/^[1-9]\d*$/.test(c.generation)) throw new Error("Invalid message context");
  return utf8(
    canonicalJson({
      domain: "osp/v1/direct-message",
      chainId: c.chainId,
      contract: c.contract,
      sender: c.sender,
      recipient: c.recipient,
      id: toBase64url(c.messageId),
      generation: c.generation,
    })
  );
}
export function encryptDirectMessage(
  c: DirectMessageContext,
  text: string,
  participants: Recipient[],
  rng: Rng = randomBytes
): { envelope: Uint8Array; contentHash: Uint8Array } {
  if (!text.trim() || utf8(text).length > 2500) throw new Error("Messages must contain 1–2500 UTF-8 bytes");
  if (
    c.sender === c.recipient ||
    participants.length !== 2 ||
    ![c.sender, c.recipient].every((a) => participants.some((p) => bytesEqual(addressToBytes(p.address), addressToBytes(a))))
  )
    throw new Error("Both participants need verified encryption keys");
  const key = rng(32),
    nonce = rng(24);
  try {
    const ciphertext = xchacha20poly1305(key, nonce, aad(c)).encrypt(utf8(text));
    const keys = participants.map((p) =>
      sealEpochKey({
        author: c.sender,
        audienceId: c.messageId,
        epoch: 0,
        epochKey: key,
        recipient: p.address,
        recipientPublicKey: p.publicKey,
        recipientKeyVersion: p.keyVersion,
        rng,
      })
    );
    const envelope = encode("osp.envelope.direct_message_envelope", { version: 1, nonce, ciphertext, keys });
    if (envelope.length > 4096) throw new Error("Encrypted message is too large");
    return { envelope, contentHash: sha256(envelope) };
  } finally {
    key.fill(0);
  }
}
/** expectedHash must come from messaging.get_message, never from the indexer. */
export function decryptDirectMessage(
  c: DirectMessageContext,
  envelope: Uint8Array,
  expectedHash: Uint8Array,
  account: string,
  secretForVersion: (version: number) => Uint8Array
): string {
  if (envelope.length > 4096 || expectedHash.length !== 32 || !bytesEqual(sha256(envelope), expectedHash))
    throw new Error("Message does not match its on-chain commitment");
  if (account !== c.sender && account !== c.recipient) throw new Error("Not a conversation participant");
  const e = decode<MessageEnvelope>("osp.envelope.direct_message_envelope", envelope);
  if (e.version !== 1 || e.nonce.length !== 24 || e.keys.length !== 2) throw new Error("Unsupported message envelope");
  const sealed = e.keys.find((k) => bytesEqual(k.recipient, addressToBytes(account)));
  if (!sealed || !Number.isInteger(sealed.recipient_key_version) || sealed.recipient_key_version < 1)
    throw new Error("No decryption key for this account");
  const secret = secretForVersion(sealed.recipient_key_version);
  let key: Uint8Array | undefined;
  try {
    key = openEpochKey({ author: c.sender, audienceId: c.messageId, epoch: 0, sealed, recipientSecretKey: secret });
    return utf8Decode(xchacha20poly1305(key, e.nonce, aad(c)).decrypt(e.ciphertext));
  } finally {
    secret.fill(0);
    key?.fill(0);
  }
}
