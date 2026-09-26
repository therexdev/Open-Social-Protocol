/**
 * Profile documents referenced by identity_record.profile_hash / profile_uri.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { PROFILE_VERSION } from "./constants.js";
import { decode, encode, fromBase64url } from "./encoding.js";
import type { MediaItem } from "./crypto/envelope.js";

/** osp.envelope.profile */
export interface Profile {
  version?: number;
  display_name?: string;
  bio?: string;
  avatar?: MediaItem;
  links?: string[];
}

export interface DecodedProfile {
  version: number;
  display_name: string;
  bio: string;
  avatar?: Required<MediaItem> & { size: string };
  links: string[];
}

const PROFILE_TYPE = "osp.envelope.profile";

/** Canonical profile bytes (version defaults to 1). */
export function encodeProfile(profile: Profile): Uint8Array {
  return encode(PROFILE_TYPE, { version: PROFILE_VERSION, ...profile } as Record<string, unknown>);
}

export function decodeProfile(bytes: Uint8Array): DecodedProfile {
  return decode<DecodedProfile>(PROFILE_TYPE, bytes);
}

/** sha256 of the canonical profile document, i.e. `identity.register.profile_hash`. */
export function profileHash(profile: Profile | Uint8Array): Uint8Array {
  return sha256(profile instanceof Uint8Array ? profile : encodeProfile(profile));
}

/** Public inline profile documents; never fetch arbitrary profile URLs. */
export const PROFILE_URI_PREFIX = "data:application/x-osp-profile;base64,";
export function decodeProfileUri(uri: string | null | undefined): DecodedProfile | undefined {
  if (!uri?.startsWith(PROFILE_URI_PREFIX) || uri.length > 512) return undefined;
  const encoded = uri.slice(PROFILE_URI_PREFIX.length);
  if (!encoded || !/^[A-Za-z0-9_+/-]+={0,2}$/.test(encoded)) return undefined;
  try { return decodeProfile(fromBase64url(encoded)); } catch { return undefined; }
}

/** Case/accent-insensitive nickname matching; addresses remain case-sensitive. */
export function normalizeNickname(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function searchPeople<T extends { account: string; profileUri: string }>(people: T[], query: string, limit = 20): T[] {
  const text = query.trim();
  const normalized = normalizeNickname(text);
  const rank = (person: T): number => {
    const name = normalizeNickname(decodeProfileUri(person.profileUri)?.display_name ?? "");
    if (!normalized) return 4;
    if (person.account === text) return 0;
    if (name === normalized) return 1;
    if (name.startsWith(normalized)) return 2;
    if (person.account.startsWith(text) || name.includes(normalized)) return 3;
    return 9;
  };
  return people.map(person => ({ person, rank: rank(person) })).filter(x => x.rank < 9)
    .sort((a, b) => a.rank - b.rank || a.person.account.localeCompare(b.person.account, "en"))
    .slice(0, limit).map(x => x.person);
}
