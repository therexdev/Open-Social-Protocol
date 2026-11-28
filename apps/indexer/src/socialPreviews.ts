/** Public link cards. These reads never accept a viewer or decrypt private content. */
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Root, RootContent } from "mdast";
import {
  AUDIENCE, LIFECYCLE, SUITE, ProtocolClient, bytesEqual, compactHostedMedia,
  contentHash, createContentLoader, createPostTextResolver, decodeEnvelope, decodeProfile,
  decryptContent, fromBase64url, hydrateContent, parseContentReference, parsePhotoLocation,
  PROFILE_URI_PREFIX, readMediaResponse, toBase64url, utf8,
  type Content, type MediaPoster,
} from "@osp/sdk";
import type { IndexerConfig } from "./config.js";
import type { IndexerDb } from "./db.js";
import { getPost, getProfile } from "./queries.js";

export interface SocialPreview {
  version: 1;
  public: boolean;
  title: string;
  description: string;
  image?: { path: string; type: string; alt: string };
}
export interface PreviewDependencies {
  reads?: Pick<ProtocolClient["reads"]["publications"], "get_post" | "get_photo">;
  fetch?: typeof fetch;
}
const fallback = (): SocialPreview => ({ version: 1, public: false, title: "Open Social", description: "Your people. Your world. Connect and share on Open Social." });
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const normalizedId = (id: string) => /^[A-Za-z0-9_-]{43}=?$/.test(id) && toBase64url(fromBase64url(id)).replace(/=+$/, "") === id.replace(/=+$/, "") ? toBase64url(fromBase64url(id)) : undefined;

/** Visible words, including link labels and image alt text, without raw HTML. */
export function previewText(source: string, limit = 200): string {
  const read = (node: Root | RootContent): string => {
    if (node.type === "html") return " ";
    if (node.type === "image") return node.alt ?? "";
    if ("value" in node) return String(node.value);
    if ("children" in node) return node.children.map(read).join(["root", "list", "listItem", "blockquote"].includes(node.type) ? " " : "");
    return "";
  };
  const text = read(fromMarkdown(source.slice(0, 100_000))).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  const excerpt = chars.slice(0, limit - 1).join("");
  const lastSpace = excerpt.lastIndexOf(" ");
  return (lastSpace > limit * 0.7 ? excerpt.slice(0, lastSpace) : excerpt).trimEnd() + "…";
}

interface ImageSource { url: string; digest: Uint8Array; size: number; type: string; alt: string }
export function registerSocialPreviews(app: FastifyInstance, db: IndexerDb, config: IndexerConfig, dependencies: PreviewDependencies = {}): void {
  const deployment = config.deployment;
  const fetchFn = dependencies.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const load = deployment && config.contentPublicUrl ? createContentLoader({ publicUrl: config.contentPublicUrl, chainId: deployment.chainId, identityContract: deployment.contracts.identity.address, fetch: fetchFn }) : undefined;
  // No post, profile or media field may choose an arbitrary server destination.
  const root = deployment && config.contentPublicUrl ? `${config.contentPublicUrl.replace(/\/+$/, "")}/osp/${toBase64url(utf8(deployment.chainId)).replace(/=+$/, "")}/${deployment.contracts.identity.address}/` : undefined;
  const hostedUrl = (value: string, digest?: Uint8Array): string => {
    const url = new URL(value);
    if (!root || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.href !== value ||
      !url.href.startsWith(root) || !/^[A-Za-z0-9_-]{43}=?$/.test(url.href.slice(root.length)) || (digest && url.href !== root + toBase64url(digest))) throw Error("Untrusted preview location");
    return url.href;
  };
  const resolveText = createPostTextResolver(async (input, init) => fetchFn(hostedUrl(String(input)), { ...init, redirect: "error" }));
  let client: ProtocolClient | undefined;
  const reads = () => dependencies.reads ?? (client ??= new ProtocolClient({ deployment: deployment!, rpc: config.rpc })).reads.publications;

  async function imageSource(content: Content, author: string): Promise<ImageSource | undefined> {
    for (const item of content.media ?? []) {
      const media: MediaPoster | undefined = imageTypes.has(item.mime ?? "") ? item : item.mime?.startsWith("video/") ? item.poster : undefined;
      if (!media || !imageTypes.has(media.mime ?? "") || media.wrapped_key?.length || media.nonce?.length ||
        media.content_hash?.length !== 32 || !Number.isSafeInteger(Number(media.size)) || Number(media.size) < 1 || Number(media.size) > MAX_IMAGE_BYTES) continue;
      for (const location of media.locations ?? []) {
        try {
          let url = location;
          if (location.startsWith("osp-photo://")) {
            const id = parsePhotoLocation(location, deployment!.contracts.publications.address);
            const photo = (await reads().get_photo({ id }))?.value;
            if (!photo || photo.owner !== author || !bytesEqual(photo.digest, media.content_hash) || photo.size !== Number(media.size) ||
              photo.received !== photo.chunk_hashes.length || !compactHostedMedia(photo)) continue;
            url = photo.external_uri!;
          } else if (location.startsWith("osp-file:")) url = location.slice("osp-file:".length);
          return { url: hostedUrl(url, media.content_hash), digest: media.content_hash, size: Number(media.size), type: media.mime!, alt: previewText(item.alt_text || (item.mime?.startsWith("video/") ? "Video preview on Open Social" : "Photo on Open Social"), 200) };
        } catch { /* A failed image does not suppress the public text card. */ }
      }
    }
    return undefined;
  }

  const pending = new Map<string, Promise<{ preview: SocialPreview; image?: ImageSource }>>();
  async function build(id: string): Promise<{ preview: SocialPreview; image?: ImageSource }> {
    const post = getPost(db, id);
    if (!deployment || !post || post.audience !== AUDIENCE.EVERYONE || post.collectionId || post.state !== LIFECYCLE.ACTIVE) return { preview: fallback() };
    // Check current permissions/state before touching hosted bytes.
    const record = (await reads().get_post({ post_id: fromBase64url(id) }))?.value;
    if (!record || record.state !== LIFECYCLE.ACTIVE || record.audience !== AUDIENCE.EVERYONE || record.collection_id?.length ||
      record.author !== post.author || record.version_count !== post.versionNumber || !bytesEqual(record.latest_version, fromBase64url(post.contentHash))) return { preview: fallback() };
    let bytes = fromBase64url(post.envelope);
    const reference = parseContentReference(bytes);
    if (reference) { if (!load) return { preview: fallback() }; bytes = await load(reference); }
    if (!bytesEqual(contentHash(bytes), record.latest_version)) return { preview: fallback() };
    const envelope = decodeEnvelope(bytes);
    if (envelope.suite !== SUITE.PLAINTEXT) return { preview: fallback() };
    const content = await resolveText(decryptContent({ envelope }), false);
    let name = post.author;
    try {
      let profile = getProfile(db, post.author);
      if (profile && load) profile = await hydrateContent(profile, load);
      if (profile?.profileUri.startsWith(PROFILE_URI_PREFIX)) {
        const raw = fromBase64url(profile.profileUri.slice(PROFILE_URI_PREFIX.length));
        if (bytesEqual(contentHash(raw), fromBase64url(profile.profileHash))) name = previewText(decodeProfile(raw).display_name, 80) || name;
      }
    } catch { /* Author address is a usable public fallback. */ }
    const image = await imageSource(content, post.author);
    return { preview: {
      version: 1, public: true, title: `${name} on Open Social`,
      description: previewText(content.text ?? "") || (content.media?.some(m => m.mime?.startsWith("video/")) ? "Watch this video on Open Social." : image ? "See this photo on Open Social." : content.media?.some(m => m.mime?.startsWith("audio/")) ? "Listen to this audio post on Open Social." : "View this post on Open Social."),
      ...(image && { image: { path: `/v1/posts/${encodeURIComponent(id)}/preview/image?version=${post.contentHash}`, type: "image/jpeg", alt: image.alt } }),
    }, ...(image && { image }) };
  }
  // Coalesce simultaneous bot/SPA reads, bound expensive work, and never keep
  // a successful permission check after its request has finished.
  async function get(id: string): Promise<{ preview: SocialPreview; image?: ImageSource }> {
    const normalized = normalizedId(id);
    if (!normalized) return { preview: fallback() };
    id = normalized;
    const existing = pending.get(id); if (existing) return existing;
    if (pending.size >= 8) return { preview: fallback() };
    const task = build(id).catch(() => ({ preview: fallback() }));
    pending.set(id, task);
    try { return await task; } finally { pending.delete(id); }
  }
  app.get<{ Params: { postId: string } }>("/v1/posts/:postId/preview", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return (await get(request.params.postId)).preview;
  });
  let activeImages = 0;
  app.get<{ Params: { postId: string }; Querystring: { version?: string } }>("/v1/posts/:postId/preview/image", async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
    if (activeImages >= 2) return reply.code(503).header("Retry-After", "2").send();
    activeImages++;
    try {
      const { image, preview } = await get(request.params.postId);
      if (!image || !preview.public || !preview.image?.path.endsWith(`version=${request.query.version ?? ""}`)) return reply.code(404).send();
      const signal = AbortSignal.timeout(5_000);
      const response = await fetchFn(image.url, { signal, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw Error("Image unavailable");
      const bytes = await readMediaResponse(response, image.size, signal);
      if (bytes.length !== image.size || !bytesEqual(contentHash(bytes), image.digest) || imageMime(bytes) !== image.type) throw Error("Image mismatch");
      // A real thumbnail, with EXIF stripped, rather than a multi-megabyte R2 download.
      const thumbnail = await sharp(bytes, { limitInputPixels: 50_000_000 }).rotate()
        .resize({ width: 1200, height: 630, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#051724" }).jpeg({ quality: 82 }).timeout({ seconds: 3 }).toBuffer();
      return reply.type("image/jpeg").send(thumbnail);
    } catch { return reply.code(404).send(); }
    finally { activeImages--; }
  });
}

function imageMime(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytesEqual(bytes.subarray(0, 8), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  return undefined;
}
