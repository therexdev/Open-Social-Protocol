import {
  IMAGE_MIMES, PROFILE_URI_PREFIX, bytesEqual, contentHash, decodeProfileUri,
  fetchIpfsMedia, fromBase64url, parsePhotoLocation, photoLocation, profilePhotoId,
  toBase64url, verifyPhotoChunks, type DecodedProfile,
} from "@osp/sdk";
import { fetchStoredMedia } from "../../../web/src/api/mediaStorage";
import type { FeedDeps } from "./feed";
import type { EmbeddedMedia } from "../shared/protocol";

/** A refresh hint only. The photo loader verifies the actual profile on chain. */
export function profileAvatarHash(profile?: DecodedProfile): string | undefined {
  const hash = profile?.avatar_photo_hash?.length === 32 ? profile.avatar_photo_hash : profile?.avatar?.content_hash;
  return hash?.length === 32 ? toBase64url(hash) : undefined;
}

const MAX_AVATAR_CACHE_BYTES = 16 * 1024 * 1024;

/** Public profile photos, with bounded reuse across posts/comments by the same author. */
export class ProfilePhotos {
  private readonly cache = new Map<string, Promise<EmbeddedMedia>>();
  private readonly sizes = new Map<string, number>();
  private cachedBytes = 0;
  private evict(key: string): void {
    this.cachedBytes -= this.sizes.get(key) ?? 0;
    this.sizes.delete(key); this.cache.delete(key);
  }
  constructor(private readonly deps: Pick<FeedDeps, "clients">) {}

  async load(account: string, expectedHash: string): Promise<EmbeddedMedia> {
    const { protocol: client, indexer } = await this.deps.clients();
    if (!client) throw Error("Connect to the network to load profile photos.");
    const identity = (await client.reads.identity.get_identity({ account }))?.value;
    const profile = decodeProfileUri(identity?.profile_uri);
    if (!identity || identity.account !== account || !profile ||
      !bytesEqual(contentHash(fromBase64url(identity.profile_uri.slice(PROFILE_URI_PREFIX.length))), identity.profile_hash))
      throw Error("This profile could not be verified.");
    const hash = profileAvatarHash(profile);
    if (!hash || hash !== expectedHash) throw Error("This profile photo changed. Refresh the post to load it.");
    const current = profile.avatar_photo_hash?.length === 32;
    const legacy = profile.avatar;
    const mime = current ? "image/jpeg" : legacy?.mime ?? "";
    const location = current ? photoLocation(client.deployment.contracts.publications.address, profilePhotoId(account, fromBase64url(hash))) : legacy?.locations[0] ?? "";
    if (!(IMAGE_MIMES as readonly string[]).includes(mime) || (!current && !!legacy?.wrapped_key?.length))
      throw Error("Unsupported profile photo.");
    const key = JSON.stringify([client.chainId, client.deployment.contracts.publications.address, account, hash, mime, location]);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key); this.cache.set(key, cached);
      return cached;
    }
    const pending = (async () => {
      let bytes: Uint8Array;
      if (location.startsWith("osp-photo://")) {
        const id = parsePhotoLocation(location, client.deployment.contracts.publications.address);
        const record = (await client.reads.publications.get_photo({ id }))?.value;
        if (!record || record.owner !== account || !bytesEqual(record.digest, fromBase64url(hash)) || record.received !== record.chunk_hashes.length) throw Error("This profile photo could not be verified.");
        bytes = record.external_uri
          ? await fetchStoredMedia(record.external_uri, record.digest, record.size, AbortSignal.timeout(60_000))
          : verifyPhotoChunks(record, (await indexer.photoChunks(toBase64url(id))).chunks.map(fromBase64url), fromBase64url(hash));
      } else if (location.startsWith("ipfs://")) {
        bytes = await fetchIpfsMedia(location, fromBase64url(hash), { signal: AbortSignal.timeout(20_000) });
      } else throw Error("Unsupported profile photo location.");
      return { data: toBase64url(bytes), mime };
    })();
    this.cache.set(key, pending);
    while (this.cache.size > 32) this.evict(this.cache.keys().next().value!);
    try {
      const result = await pending;
      if (this.cache.get(key) === pending) {
        if (result.data.length > MAX_AVATAR_CACHE_BYTES) this.evict(key);
        else {
          this.sizes.set(key, result.data.length); this.cachedBytes += result.data.length;
          while (this.cachedBytes > MAX_AVATAR_CACHE_BYTES) this.evict(this.cache.keys().next().value!);
        }
      }
      return result;
    }
    catch (error) {
      if (this.cache.get(key) === pending) this.evict(key);
      throw error;
    }
  }
}
