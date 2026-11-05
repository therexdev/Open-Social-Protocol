import { toBase64url } from "@osp/sdk";
import type { OpenedContent } from "../../api/decrypt";
import type { MediaAttachment } from "../composer/publish";

/** Fail closed for a malformed poster or one with a different privacy setting. */
export function posterReference(media: OpenedContent["media"][number]): MediaAttachment["videoPoster"] {
  const p = media.poster;
  if (!p || !media.mime.startsWith("video/") || p.mime !== "image/jpeg" || p.content_hash?.length !== 32 ||
      !p.locations?.[0]?.startsWith("osp-photo://") || p.locations.length !== 1 ||
      !Number.isInteger(Number(p.size)) || Number(p.size) < 1 || Number(p.size) > 32768 ||
      !!p.mediaKey !== !!media.mediaKey || (!!p.wrapped_key?.length && !p.mediaKey) ||
      (p.mediaKey && (p.mediaKey.length !== 32 || p.nonce?.length !== 24))) return undefined;
  return { url: p.locations[0], mime: p.mime, size: Number(p.size), contentHash: toBase64url(p.content_hash),
    ...(p.mediaKey && { encryption: { key: toBase64url(p.mediaKey), nonce: toBase64url(p.nonce!) } }),
  };
}
