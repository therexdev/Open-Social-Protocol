import {
  IMAGE_MIMES, MUSIC_MIMES, bytesEqual, contentHash, fetchIpfsMedia, fromBase64url,
  musicCipher, musicKeyContext, openEpochKey, openMedia, parsePhotoLocation,
  toBase64url, verifyPhotoChunks, addressToBytes,
} from "@osp/sdk";
import { loadClip } from "../../../web/src/features/media/clipArchive";
import { loadMusic } from "../../../web/src/features/music/musicService";
import { configureMusicGateway } from "../../../web/src/features/music/musicGateway";
import { openPost } from "./decrypt";
import type { FeedDeps } from "./feed";
import type { EmbeddedMedia } from "../shared/protocol";

/** Receives an attachment index, never a host-supplied URL or decryption key. */
export async function embeddedMedia(deps: FeedDeps, postId: string, index: number, poster: boolean): Promise<EmbeddedMedia> {
  const clients = await deps.clients(), client = clients.protocol, session = await deps.session();
  if (!client) throw Error("Connect to the network to load this attachment.");
  const post = await clients.indexer.post(postId, session?.account);
  if (!post) throw Error("This post is unavailable.");
  const opened = await openPost(post, { chainId: client.chainId, chain: client,
    keys: session ? await deps.keys(session) : undefined, keySource: clients.indexer,
    me: session ? { account: session.account, encryption: deps.vault.encryption(session) } : undefined });
  if (!opened.content) throw Error(opened.message || "This attachment is not available to your account.");
  const original = opened.content.media?.[index], media = poster ? original?.poster : original;
  if (!media) throw Error("Attachment not found.");
  if (poster && (!original?.mime?.startsWith("video/") || media.mime !== "image/jpeg" ||
    Number(media.size) > 32768 || !!media.wrapped_key?.length !== !!original.wrapped_key?.length)) throw Error("Invalid video preview.");
  const mime = media.mime ?? "", url = media.locations?.[0] ?? "", hash = media.content_hash;
  if (hash?.length !== 32) throw Error("Attachment fingerprint is missing.");
  const encryption = media.wrapped_key?.length ? (() => {
    if (!session || media.mediaKey?.length !== 32 || media.nonce?.length !== 24) throw Error("This attachment's reading key is unavailable.");
    return { key: toBase64url(media.mediaKey), nonce: toBase64url(media.nonce) };
  })() : undefined;
  const signal = AbortSignal.timeout(90_000);
  let bytes: Uint8Array;
  configureMusicGateway(client, clients.resolved.indexerUrl);
  if (url.startsWith("osp-clip://")) {
    bytes = await loadClip({ url, mime, contentHash: hash, size: Number(media.size), encryption }, client, signal);
  } else if (url.startsWith("osp-music://")) {
    const prefix = `osp-music://${client.deployment.contracts.publications.address}/`;
    if (!url.startsWith(prefix) || !/^[A-Za-z0-9_-]{43}=?$/.test(url.slice(prefix.length))) throw Error("Invalid music reference.");
    const id = fromBase64url(url.slice(prefix.length));
    const {record, bytes: stored} = await loadMusic(client, toBase64url(id), signal, undefined, r => {
      if (r.clip_kind || !(MUSIC_MIMES as readonly string[]).includes(r.mime) || r.mime !== mime || !bytesEqual(r.digest, hash)) throw Error("Music verification failed.");
    });
    bytes = stored;
    if (record.encrypted) {
      if (!session) throw Error("Unlock your account to play this track.");
      const access = session.account === record.owner ? undefined : await client.reads.publications.get_music_access({ id, buyer: session.account });
      if (session.account !== record.owner && (!access?.eligible || access.value?.status !== 2)) throw Error("This track has not been unlocked for your account.");
      const sealed = session.account === record.owner ? record.owner_key : access?.value?.key;
      if (!sealed || sealed.key_version !== session.keyVersion) throw Error("The track reading key is unavailable in this browser.");
      const context = musicKeyContext(client.chainId, client.deployment.contracts.publications.address, id, record.owner);
      const key = openEpochKey({ ...context, recipientSecretKey: deps.vault.encryption(session).secretKey,
        sealed: { recipient: addressToBytes(session.account), recipient_key_version: sealed.key_version,
          ephemeral_public_key: sealed.ephemeral_public_key, nonce: sealed.nonce, ciphertext: sealed.ciphertext } });
      try {
        if (!record.key_hash || !bytesEqual(contentHash(key), record.key_hash)) throw Error("Track key verification failed.");
        bytes = musicCipher(context, key, record.nonce!).decrypt(stored);
      } finally { key.fill(0); }
    }
  } else {
    if (!(IMAGE_MIMES as readonly string[]).includes(mime)) throw Error("Unsupported photo format.");
    let stored: Uint8Array;
    if (url.startsWith("osp-photo://")) {
      const id = parsePhotoLocation(url, client.deployment.contracts.publications.address);
      const record = (await client.reads.publications.get_photo({ id }))?.value;
      if (!record) throw Error("This photo is still confirming.");
      stored = verifyPhotoChunks(record, (await clients.indexer.photoChunks(toBase64url(id))).chunks.map(fromBase64url), hash);
    } else if (url.startsWith("ipfs://")) stored = await fetchIpfsMedia(url, hash, { signal });
    else throw Error("This attachment is not in the archive.");
    bytes = openMedia(stored, hash, encryption ? { key: fromBase64url(encryption.key), nonce: fromBase64url(encryption.nonce) } : undefined);
  }
  // Never deliver a late private download after lock, account switch, or loss of access.
  const current = await deps.session();
  if (session && (current?.account !== session.account || current.unlockedAt !== session.unlockedAt)) throw Error("Your session changed. Unlock and reload the attachment.");
  const latest = (await client.reads.publications.get_post({ post_id: fromBase64url(postId) }))?.value;
  if (!latest || latest.state !== 0 || !bytesEqual(latest.latest_version, fromBase64url(post.contentHash))) throw Error("This post changed while the attachment loaded.");
  if (latest.collection_id?.length) {
    const group = (await client.reads.publications.get_collection({ id: latest.collection_id }))?.value;
    if (!group || group.closed || !current || (group.owner !== current.account && !group.members.includes(current.account))) throw Error("You no longer have access to this group.");
  }
  if (session) {
    const finalSession = await deps.session();
    if (finalSession?.account !== session.account || finalSession.unlockedAt !== session.unlockedAt) throw Error("Your session changed. Unlock and reload the attachment.");
  }
  return { data: toBase64url(bytes), mime };
}
