/**
 * Profile documents referenced by identity_record.profile_hash / profile_uri.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { PROFILE_VERSION } from "./constants.js";
import { decode, encode } from "./encoding.js";
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
