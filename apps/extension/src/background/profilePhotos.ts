import {
  IMAGE_MIMES, PROFILE_URI_PREFIX, bytesEqual, contentHash, decodeProfileUri,
  fetchIpfsMedia, fromBase64url, parsePhotoLocation, photoLocation, profilePhotoId,
  toBase64url, verifyPhotoChunks, type DecodedProfile,
} from "@osp/sdk";
import type { FeedDeps } from "./feed";
import type { EmbeddedMedia } from "../shared/protocol";

/** A refresh hint only. The photo loader verifies the actual profile on chain. */
export function profileAvatarHash(profile?: DecodedProfile): string | undefined {
  const hash = profile?.avatar_photo_hash?.length === 32 ? profile.avatar_photo_hash : profile?.avatar?.content_hash;
  return hash?.length === 32 ? toBase64url(hash) : undefined;
}

/** Public profile photos, with bounded reuse across posts/comments by the same author. */
export class ProfilePhotos {
  private readonly cache = new Map<string, Promise<EmbeddedMedia>>();
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
        if (!record) throw Error("This profile photo is still confirming.");
        bytes = verifyPhotoChunks(record, (await indexer.photoChunks(toBase64url(id))).chunks.map(fromBase64url), fromBase64url(hash));
      } else if (location.startsWith("ipfs://")) {
        bytes = await fetchIpfsMedia(location, fromBase64url(hash), { signal: AbortSignal.timeout(20_000) });
      } else throw Error("Unsupported profile photo location.");
      return { data: toBase64url(bytes), mime };
    })();
    this.cache.set(key, pending);
    while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
    try { return await pending; }
    catch (error) {
      if (this.cache.get(key) === pending) this.cache.delete(key);
      throw error;
    }
  }
}
