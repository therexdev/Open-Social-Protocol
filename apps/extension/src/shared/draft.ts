/**
 * Draft size rules. The chain limit is the encoded envelope (`LIMITS.maxEnvelopeBytes`, 4096
 * bytes), not a character count: a 3000-character CJK post encodes to ~9 KiB. The check builds
 * the same content document `publishPost` builds (text, mime, created_at, external_ref) and
 * measures the suite-1 (friends) envelope, the larger of the two suites, because the audience can
 * still change at confirmation time. Used by the composer counter and by the service worker before
 * a draft is created, so a draft that cannot be published never enters the queue.
 */
import { ENVELOPE_VERSION, LIMITS, SUITE, encodeContent, encodeEnvelope, type Content } from "@osp/sdk";

export const MAX_ENVELOPE_BYTES = LIMITS.maxEnvelopeBytes;

/** Poly1305 tag, XChaCha20 nonce, wrapped 32-byte content key (+tag), wrap nonce: suite 1 (spec 5.1). */
const TAG_BYTES = 16;
const WRAPPED_KEY_BYTES = LIMITS.keyBytes + TAG_BYTES;

/**
 * `created_at` is a uint64 varint: every millisecond timestamp until the year 2109 (2^42 - 1)
 * encodes in 6 bytes, so this placeholder measures exactly what a real timestamp would.
 */
const CREATED_AT_PLACEHOLDER = "4398046511103";

/** The content document a draft publishes (same shape as `publishPost`). */
export function draftContent(text: string, externalRef?: string, createdAt: string = CREATED_AT_PLACEHOLDER): Content {
  return {
    version: 1,
    text,
    mime: "text/plain",
    created_at: createdAt,
    ...(externalRef && { external_ref: externalRef }),
  };
}

/** Exact byte size of the suite-1 envelope the draft would produce (worst case across audiences). */
export function draftEnvelopeBytes(text: string, externalRef?: string): number {
  const plaintext = encodeContent(draftContent(text, externalRef));
  const filled = (length: number) => new Uint8Array(length).fill(1);
  return encodeEnvelope({
    version: ENVELOPE_VERSION,
    suite: SUITE.XCHACHA20POLY1305_X25519,
    payload: filled(plaintext.length + TAG_BYTES),
    nonce: filled(LIMITS.nonceBytes),
    wrapped_content_key: filled(WRAPPED_KEY_BYTES),
    wrap_nonce: filled(LIMITS.nonceBytes),
  }).length;
}

export interface DraftSize {
  bytes: number;
  limit: number;
  ok: boolean;
}

export function measureDraft(text: string, externalRef?: string): DraftSize {
  const bytes = draftEnvelopeBytes(text, externalRef);
  return { bytes, limit: MAX_ENVELOPE_BYTES, ok: bytes <= MAX_ENVELOPE_BYTES };
}

/** A human message when the draft cannot be published as is; undefined when it fits. */
export function draftSizeError(text: string, externalRef?: string): string | undefined {
  const size = measureDraft(text, externalRef);
  if (size.ok) return undefined;
  const over = size.bytes - size.limit;
  return `The post is ${size.bytes} bytes once encoded, ${over} above the ${size.limit}-byte limit. Shorten the text${externalRef ? " or drop the shared link" : ""}.`;
}
