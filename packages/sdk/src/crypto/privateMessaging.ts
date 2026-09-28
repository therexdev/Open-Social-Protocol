/**
 * Private messaging v2. Olm/Vodozemac owns the Double Ratchet; this module binds
 * its authenticated plaintext to OSP's chain, contract, aliases and packet ids.
 * Device keys, Olm accounts and pickle keys MUST be random, never seed-derived.
 */
import type {
  Session as OlmSession,
  InboundCreationResult,
  OlmMessage,
} from "@towns-protocol/vodozemac";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { Signer, type SignerInterface } from "koilib";
import {
  canonicalJson,
  concat,
  fromBase64url,
  toBase64url,
  toHex,
  utf8,
  utf8Decode,
} from "../encoding.js";
import { randomBytes, x25519KeyPair, x25519SharedSecret } from "./keys.js";

export interface PrivateScope {
  chainId: string;
  contract: string;
}
export interface PrivatePacketContext extends PrivateScope {
  actor: string;
  peer: string;
  packetId: string;
}
export interface RatchetSetup {
  account: string;
  identityKey: string;
  oneTimeKey: string;
}
export interface RatchetState {
  pickle: string;
  sessionId: string;
}
export interface RatchetWire {
  type: number;
  body: string;
}
/** Optional authenticated routing information; older v2 readers still see text. */
export interface PrivateMessageMetadata {
  id: string;
  deviceId: string;
  threadId: string;
  sentAt: number;
}
function validMessageMetadata(value: unknown): value is PrivateMessageMetadata {
  if (!value || typeof value !== "object") return false;
  const m = value as PrivateMessageMetadata;
  const key = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{43}=$/.test(v)
    && fromBase64url(v).length === 32 && toBase64url(fromBase64url(v)) === v;
  return key(m.id) && key(m.deviceId) && key(m.threadId) && Number.isSafeInteger(m.sentAt) && m.sentAt >= 0;
}
export const PRIVATE_MESSAGE_LIMIT = 2500;
export const PRIVATE_INVITATION_PLAINTEXT = 4096;
export const PRIVATE_PACKET_LIMIT = 6144;
let ready: Promise<typeof import("@towns-protocol/vodozemac")> | undefined;
async function olm() {
  return (ready ??= import("@towns-protocol/vodozemac")
    .then(async (lib) => {
      await lib.initAsync();
      return lib;
    })
    .catch((error) => {
      ready = undefined;
      throw error;
    }));
}

/** Secret-input HKDF; unlike public child derivation, publishing a leaf reveals no sibling. */
export function privateWallet(
  seed: Uint8Array,
  scope: PrivateScope,
  purpose: "conversation" | "invitation",
  id: string,
): Signer {
  if (seed.length !== 32 || fromBase64url(id).length !== 32)
    throw new Error("Invalid private wallet derivation input");
  const secret = hkdf(
    sha256,
    seed,
    new Uint8Array(),
    utf8(
      canonicalJson({ domain: "osp/private-wallet/v2", ...scope, purpose, id }),
    ),
    32,
  );
  try {
    return Signer.fromSeed(toHex(secret));
  } finally {
    secret.fill(0);
  }
}

function statementHash(
  scope: PrivateScope,
  purpose: string,
  payload: unknown,
): Uint8Array {
  return sha256(
    utf8(
      canonicalJson({
        domain: "osp/private-proof/v2",
        ...scope,
        purpose,
        payload,
      }),
    ),
  );
}
export async function signPrivateStatement(
  scope: PrivateScope,
  purpose: string,
  payload: unknown,
  signer: SignerInterface,
): Promise<string> {
  return toBase64url(
    await signer.signHash(statementHash(scope, purpose, payload)),
  );
}
export function verifyPrivateStatement(
  scope: PrivateScope,
  purpose: string,
  payload: unknown,
  signature: string,
  owner: string,
): boolean {
  try {
    return (
      Signer.recoverAddress(
        statementHash(scope, purpose, payload),
        fromBase64url(signature),
      ) === owner
    );
  } catch {
    return false;
  }
}

/** Fixed-size sealed invitations have no public recipient key id or identity signature. */
export function sealPrivateInvitation(
  context: PrivatePacketContext,
  publicKey: Uint8Array,
  value: unknown,
): Uint8Array {
  const plaintext = utf8(JSON.stringify(value));
  if (plaintext.length > PRIVATE_INVITATION_PLAINTEXT - 2)
    throw new Error("Private invitation is too large");
  const padded = randomBytes(PRIVATE_INVITATION_PLAINTEXT);
  padded[0] = plaintext.length >>> 8;
  padded[1] = plaintext.length & 255;
  padded.set(plaintext, 2);
  const ephemeral = x25519KeyPair(),
    nonce = randomBytes(24);
  const shared = x25519SharedSecret(ephemeral.secretKey, publicKey);
  const aad = utf8(
    canonicalJson({ domain: "osp/private-invitation/v2", ...context }),
  );
  const key = hkdf(sha256, shared, new Uint8Array(), aad, 32);
  try {
    return concat(
      ephemeral.publicKey,
      nonce,
      xchacha20poly1305(key, nonce, aad).encrypt(padded),
    );
  } finally {
    shared.fill(0);
    key.fill(0);
    ephemeral.secretKey.fill(0);
    padded.fill(0);
    plaintext.fill(0);
  }
}
export function openPrivateInvitation<T>(
  context: PrivatePacketContext,
  secret: Uint8Array,
  envelope: Uint8Array,
): T | undefined {
  if (envelope.length !== PRIVATE_INVITATION_PLAINTEXT + 72) return undefined;
  let key: Uint8Array | undefined,
    shared: Uint8Array | undefined,
    plaintext: Uint8Array | undefined;
  try {
    shared = x25519SharedSecret(secret, envelope.subarray(0, 32));
    const aad = utf8(
      canonicalJson({ domain: "osp/private-invitation/v2", ...context }),
    );
    key = hkdf(sha256, shared, new Uint8Array(), aad, 32);
    plaintext = xchacha20poly1305(key, envelope.subarray(32, 56), aad).decrypt(
      envelope.subarray(56),
    );
    const length = plaintext[0]! * 256 + plaintext[1]!;
    if (length > plaintext.length - 2) return undefined;
    return JSON.parse(utf8Decode(plaintext.subarray(2, 2 + length))) as T;
  } catch {
    return undefined;
  } finally {
    key?.fill(0);
    shared?.fill(0);
    plaintext?.fill(0);
  }
}

/** One independent account/prekey per invitation avoids shared prekey claim races. */
export async function createRatchetSetup(
  pickleKey: Uint8Array,
): Promise<RatchetSetup> {
  const lib = await olm(),
    account = new lib.Account();
  try {
    const generated = account.generate_one_time_keys(1);
    generated.free();
    const keys = account.one_time_keys as Map<string, string>;
    const oneTimeKey = keys.values().next().value;
    if (!oneTimeKey) throw new Error("No one-time messaging key generated");
    return {
      account: account.pickle(pickleKey),
      identityKey: account.curve25519_key,
      oneTimeKey,
    };
  } finally {
    account.free();
  }
}

export async function acceptRatchet(
  pickleKey: Uint8Array,
  setup: Pick<RatchetSetup, "identityKey" | "oneTimeKey">,
  payload: unknown,
): Promise<{ state: RatchetState; wire: RatchetWire; identityKey: string }> {
  const lib = await olm(),
    account = new lib.Account();
  let session: OlmSession | undefined, message: OlmMessage | undefined;
  try {
    session = account.create_outbound_session(
      setup.identityKey,
      setup.oneTimeKey,
      lib.SessionConfigVersion.V2,
    );
    message = session.encrypt(JSON.stringify(payload));
    return {
      state: {
        pickle: session.pickle(pickleKey),
        sessionId: session.session_id,
      },
      wire: {
        type: message.message_type,
        body: toBase64url(message.ciphertext),
      },
      identityKey: account.curve25519_key,
    };
  } finally {
    message?.free();
    session?.free();
    account.free();
  }
}

export async function finishRatchet<T>(
  pickleKey: Uint8Array,
  setupAccount: string,
  identityKey: string,
  wire: RatchetWire,
): Promise<{ state: RatchetState; payload: T }> {
  const lib = await olm(),
    account = lib.Account.from_pickle(setupAccount, pickleKey);
  let message: OlmMessage | undefined;
  let inbound: InboundCreationResult | undefined,
    session: OlmSession | undefined;
  try {
    message = wireMessage(lib, wire);
    inbound = account.create_inbound_session(identityKey, message);
    session = inbound.session;
    return {
      state: {
        pickle: session.pickle(pickleKey),
        sessionId: session.session_id,
      },
      payload: JSON.parse(inbound.plaintext) as T,
    };
  } finally {
    session?.free();
    inbound?.free();
    message?.free();
    account.free();
  }
}

function wireMessage(lib: Awaited<ReturnType<typeof olm>>, wire: RatchetWire) {
  if (
    !wire ||
    (wire.type !== 0 && wire.type !== 1) ||
    typeof wire.body !== "string" ||
    wire.body.length > PRIVATE_PACKET_LIMIT * 2
  )
    throw new Error("Invalid ratchet packet");
  return new lib.OlmMessage(wire.type, fromBase64url(wire.body));
}

export async function encryptPrivateMessage(
  pickleKey: Uint8Array,
  state: RatchetState,
  context: PrivatePacketContext,
  text: string,
  metadata?: PrivateMessageMetadata,
): Promise<{ state: RatchetState; envelope: Uint8Array }> {
  if (!text.trim() || utf8(text).length > PRIVATE_MESSAGE_LIMIT)
    throw new Error(
      `Message must contain 1–${PRIVATE_MESSAGE_LIMIT} UTF-8 bytes`,
    );
  if (metadata && !validMessageMetadata(metadata)) throw new Error("Invalid message routing metadata");
  const lib = await olm(),
    session = lib.Session.from_pickle(state.pickle, pickleKey);
  let message: OlmMessage | undefined;
  try {
    if (session.session_id !== state.sessionId)
      throw new Error("Messaging session mismatch");
    message = session.encrypt(
      JSON.stringify({
        domain: "osp/private-message/v2",
        ...context,
        sessionId: state.sessionId,
        text,
        ...(metadata && { metadata }),
      }),
    );
    const envelope = utf8(
      JSON.stringify({
        type: message.message_type,
        body: toBase64url(message.ciphertext),
      }),
    );
    if (envelope.length > PRIVATE_PACKET_LIMIT)
      throw new Error("Encrypted message is too large");
    return {
      state: { pickle: session.pickle(pickleKey), sessionId: state.sessionId },
      envelope,
    };
  } finally {
    message?.free();
    session.free();
  }
}

/** Works on a fresh clone. A rejected packet never advances the persisted session. */
export async function decryptPrivateMessage(
  pickleKey: Uint8Array,
  state: RatchetState,
  context: PrivatePacketContext,
  envelope: Uint8Array,
): Promise<{ state: RatchetState; text: string; metadata?: PrivateMessageMetadata }> {
  if (envelope.length > PRIVATE_PACKET_LIMIT)
    throw new Error("Encrypted message is too large");
  const lib = await olm(),
    session = lib.Session.from_pickle(state.pickle, pickleKey);
  let message: OlmMessage | undefined;
  try {
    message = wireMessage(lib, JSON.parse(utf8Decode(envelope)) as RatchetWire);
    const payload = JSON.parse(
      session.decrypt(message),
    ) as PrivatePacketContext & {
      domain: string;
      sessionId: string;
      text: string;
      metadata?: PrivateMessageMetadata;
    };
    if (
      payload.domain !== "osp/private-message/v2" ||
      payload.sessionId !== state.sessionId ||
      session.session_id !== state.sessionId ||
      payload.chainId !== context.chainId ||
      payload.contract !== context.contract ||
      payload.actor !== context.actor ||
      payload.peer !== context.peer ||
      payload.packetId !== context.packetId ||
      typeof payload.text !== "string" ||
      !payload.text.trim() ||
      utf8(payload.text).length > PRIVATE_MESSAGE_LIMIT
      || (payload.metadata !== undefined && !validMessageMetadata(payload.metadata))
    )
      throw new Error("Message authentication context mismatch");
    return {
      state: { pickle: session.pickle(pickleKey), sessionId: state.sessionId },
      text: payload.text,
      ...(payload.metadata && { metadata: payload.metadata }),
    };
  } finally {
    message?.free();
    session.free();
  }
}
