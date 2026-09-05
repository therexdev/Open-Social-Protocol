/**
 * Profile documents: display name and bio encoded with the SDK profile helpers into a data:
 * URI stored in identity_record.profile_uri (<= 512 chars on chain), with profile_hash.
 */
import { decodeProfile, encodeProfile, profileHash, type DecodedProfile, type Profile } from "@osp/sdk";
import { bytesOf, toBase64url } from "../util/bytes";
import type { ProfileView } from "./indexer";

export const PROFILE_URI_PREFIX = "data:application/x-osp-profile;base64,";
export const PROFILE_URI_MAX_CHARS = 512;

export interface ProfileDocument {
  uri: string;
  hash: Uint8Array;
  bytes: Uint8Array;
}

/** Builds the on-chain reference for a profile document. */
export function buildProfileDocument(profile: Profile): ProfileDocument {
  const bytes = encodeProfile(profile);
  const uri = bytes.length === 0 ? "" : `${PROFILE_URI_PREFIX}${toBase64url(bytes)}`;
  return { uri, hash: profileHash(bytes), bytes };
}

export function profileUriTooLong(uri: string): boolean {
  return uri.length > PROFILE_URI_MAX_CHARS;
}

/** Decodes a profile document from a data: URI (other URI schemes are not fetched). */
export function parseProfileUri(uri: string | undefined | null): DecodedProfile | undefined {
  if (!uri || !uri.startsWith(PROFILE_URI_PREFIX)) return undefined;
  const bytes = bytesOf(uri.slice(PROFILE_URI_PREFIX.length));
  if (bytes.length === 0) return undefined;
  try {
    return decodeProfile(bytes);
  } catch {
    return undefined;
  }
}

export interface ProfileInfo {
  account: string;
  displayName: string;
  bio: string;
  registered: boolean;
  view?: ProfileView;
  document?: DecodedProfile;
}

export function profileInfo(account: string, view: ProfileView | undefined): ProfileInfo {
  const document = parseProfileUri(view?.profileUri);
  return {
    account,
    displayName: document?.display_name?.trim() || "",
    bio: document?.bio ?? "",
    registered: view !== undefined,
    ...(view && { view }),
    ...(document && { document }),
  };
}
