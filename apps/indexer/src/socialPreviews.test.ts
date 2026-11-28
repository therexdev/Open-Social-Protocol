import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { contentHash, contentReference, encodeContentReference, encryptContent, photoLocation, storePostText, toBase64url, utf8, type Content } from "@osp/sdk";
import { buildApi } from "./api.js";
import { IndexerDb, KoinosChain, createIndexer, loadConfig } from "./index.js";
import { ChainBuilder, FakeProvider, testDeployment, ospEvent, tx } from "./testing/fake-chain.js";
import { previewText, type PreviewDependencies } from "./socialPreviews.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(content: Content = { text: "# Hello **world**\n\nA [useful link](https://example.com).", mime: "text/plain" }, options: { audience?: number; state?: number; collection?: boolean; encrypted?: boolean } = {}) {
  const deployment = testDeployment(), builder = new ChainBuilder(deployment);
  const author = deployment.contracts.identity.address, id = new Uint8Array(32).fill(34), photoId = new Uint8Array(32).fill(35);
  const envelope = encryptContent({ content, ...(options.encrypted && { epochKey: new Uint8Array(32).fill(9), aad: { chainId: deployment.chainId, author, audience: 1, epoch: 1, versionNumber: 1 } }) }).bytes;
  const ref = contentReference(envelope);
  builder.block([tx([ospEvent(deployment, "osp.publications.published", { author, post_id: id, sequence: "1", version_number: 1, content_hash: ref.digest, envelope: encodeContentReference(ref), audience: options.audience ?? 0, collection_id: options.collection ? photoId : new Uint8Array(), timestamp: String(builder.baseTimestamp), protocol_version: 1 }, [author])])]);
  const config = loadConfig({ OSP_NETWORK: "test", OSP_CONTENT_PUBLIC_URL: "https://media.example" }, { deployment });
  const db = IndexerDb.memory(), indexer = createIndexer({ config, db, chain: new KoinosChain(new FakeProvider(builder), deployment) });
  cleanups.push(() => indexer.close());
  await indexer.syncer!.syncToHead();
  if (options.state !== undefined) db.run("UPDATE posts SET state=? WHERE post_id=?", options.state, toBase64url(id));
  const root = `https://media.example/osp/${toBase64url(utf8(deployment.chainId)).replace(/=+$/, "")}/${author}/`;
  const files = new Map<string, Uint8Array>([[root + toBase64url(ref.digest), envelope]]);
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => { const data = files.get(String(input)); return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 }); });
  const record = { author, sequence: "1", reply_to: new Uint8Array(), created_at: "1", updated_at: "1", state: options.state ?? 0, audience: options.audience ?? 0, collection_id: options.collection ? photoId : new Uint8Array(), version_count: 1, latest_version: ref.digest };
  const get_post = vi.fn(async () => ({ value: record }));
  const get_photo = vi.fn<NonNullable<PreviewDependencies["reads"]>["get_photo"]>().mockResolvedValue(undefined);
  const api = buildApi({ db, config, previewDependencies: { reads: { get_post, get_photo }, fetch: fetchFn } });
  cleanups.push(() => api.close());
  const path = `/v1/posts/${toBase64url(id)}/preview`;
  return { api, path, id, author, record, get_post, get_photo, fetchFn, files, root, ref, envelope, deployment, photoId };
}

it("creates a bounded Markdown-free public snippet from verified R2 content", async () => {
  const f = await fixture();
  const response = await f.api.inject(f.path);
  expect(response.statusCode).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.json()).toMatchObject({ version: 1, public: true, title: `${f.author} on Open Social`, description: "Hello world A useful link." });
  expect(f.fetchFn).toHaveBeenCalledTimes(1);
  expect(previewText("**Hi** @[Rex](osp:1EiR6tc8jtVK6boR5w1chjq17XEXXHiNk4) &amp; <script>ignore</script>")).toBe("Hi @Rex & ignore");
  expect(Array.from(previewText("🐢 ".repeat(200))).length).toBeLessThanOrEqual(200);
});

it.each([{ audience: 1 }, { audience: 2 }, { collection: true }, { state: 1 }, { state: 2 }, { state: 3 }])("never reads private/group/inactive hosted content: %j", async options => {
  const f = await fixture({ text: "SECRET" }, options);
  const response = await f.api.inject(f.path);
  expect(response.json()).toMatchObject({ public: false, title: "Open Social" });
  expect(response.body).not.toContain("SECRET");
  expect(f.fetchFn).not.toHaveBeenCalled(); expect(f.get_post).not.toHaveBeenCalled();
});

it("rejects encrypted envelopes, stale versions, changed permissions and unavailable RPCs", async () => {
  const encrypted = await fixture({ text: "SECRET" }, { encrypted: true });
  expect((await encrypted.api.inject(encrypted.path)).json().public).toBe(false);
  const f = await fixture();
  f.record.audience = 1;
  expect((await f.api.inject(f.path)).json().public).toBe(false); expect(f.fetchFn).not.toHaveBeenCalled();
  f.record.audience = 0; f.record.latest_version = new Uint8Array(32).fill(1);
  expect((await f.api.inject(f.path)).json().public).toBe(false); expect(f.fetchFn).not.toHaveBeenCalled();
  f.record.latest_version = f.ref.digest;
  f.get_post.mockRejectedValueOnce(Error("offline"));
  expect((await f.api.inject(f.path)).json().public).toBe(false);
  expect((await f.api.inject(f.path)).json().public).toBe(true);
  // A later deletion cannot reuse a successful permission check.
  f.record.state = 2;
  expect((await f.api.inject(f.path)).json().public).toBe(false);
});

it("resolves long hosted text with its fingerprint, refusing other origins and corrupt bytes", async () => {
  const f = await fixture();
  const text = "# A longer story\n\n" + "Here is some detailed writing. ".repeat(800);
  const bytes = utf8(text), url = f.root + toBase64url(contentHash(bytes));
  const text_ref = await storePostText(text, false, async () => url);
  const long = await fixture({ text: "This is a longer post. Update your Open Social client to read the full text.", mime: "text/plain", text_ref });
  long.files.set(url, bytes);
  expect((await long.api.inject(long.path)).json().description).toMatch(/^A longer story Here is some detailed writing/);
  const malicious = await fixture({ text: "This is a longer post. Update your Open Social client to read the full text.", mime: "text/plain", text_ref: text_ref.replace("https://media.example", "https://internal.invalid") });
  expect((await malicious.api.inject(malicious.path)).json().public).toBe(false);
  expect(malicious.fetchFn.mock.calls.some(([input]) => String(input).includes("internal.invalid"))).toBe(false);
  const corrupt = await fixture(); corrupt.files.set(corrupt.root + toBase64url(corrupt.ref.digest), utf8("tampered"));
  expect((await corrupt.api.inject(corrupt.path)).json().public).toBe(false);
});

it.each([{ video: false, portrait: false }, { video: true, portrait: false }, { video: false, portrait: true }])("serves a verified, resized JPEG for an uploaded photo/video poster (%j), never the video itself", async ({ video, portrait }) => {
  const image = new Uint8Array(await sharp({ create: { width: portrait ? 600 : 1800, height: portrait ? 1800 : 900, channels: 3, background: "#33cab7" } }).png().toBuffer());
  const digest = contentHash(image), deployment = testDeployment(), photoId = new Uint8Array(32).fill(35);
  const media = { content_hash: digest, size: image.length, mime: "image/png", locations: [photoLocation(deployment.contracts.publications.address, photoId)] };
  // The protocol's video posters are JPEGs, so encode an actual JPEG for that fixture.
  const poster = new Uint8Array(await sharp(image).resize(240).jpeg().toBuffer());
  const posterHash = contentHash(poster);
  const content: Content = { text: "My photo / video", media: video ? [{ content_hash: new Uint8Array(32).fill(99), mime: "video/mp4", size: "2000000000", locations: ["osp-file:https://internal.invalid/podcast"], poster: { ...media, content_hash: posterHash, mime: "image/jpeg", size: poster.length } }] : [media] };
  const f = await fixture(content), original = video ? poster : image, hash = video ? posterHash : digest;
  const url = f.root + toBase64url(hash); f.files.set(url, original);
  f.get_photo.mockResolvedValue({ value: { owner: f.author, digest: hash, size: original.length, received: 1, chunk_hashes: [hash], units: 1, external_uri: url } });
  const preview = (await f.api.inject(f.path)).json();
  expect(preview.image).toMatchObject({ type: "image/jpeg", path: `${f.path.replace(toBase64url(f.id), encodeURIComponent(toBase64url(f.id)))}/image?version=${toBase64url(f.ref.digest)}` });
  const response = await f.api.inject(preview.image.path);
  expect(response.statusCode).toBe(200); expect(response.headers["content-type"]).toBe("image/jpeg");
  const details = await sharp(response.rawPayload).metadata();
  expect(details.width).toBe(1200); expect(details.height).toBe(630); expect(details.exif).toBeUndefined();
  expect(f.fetchFn.mock.calls.every(([input]) => String(input).startsWith(f.root))).toBe(true);
  expect((await f.api.inject(`${f.path}/image?version=${toBase64url(new Uint8Array(32))}`)).statusCode).toBe(404);
  f.files.set(url, utf8("<svg>untrusted replacement</svg>"));
  expect((await f.api.inject(preview.image.path)).statusCode).toBe(404);
  f.record.state = 2;
  expect((await f.api.inject(preview.image.path)).statusCode).toBe(404);
});

it("does not fetch an arbitrary image URL or query RPCs for unknown/malformed IDs", async () => {
  const f = await fixture({ media: [{ content_hash: new Uint8Array(32).fill(2), mime: "image/jpeg", size: 100, locations: ["https://internal.invalid/private.jpg"] }] });
  expect((await f.api.inject(f.path)).json().image).toBeUndefined();
  expect(f.fetchFn.mock.calls.every(([input]) => String(input).startsWith(f.root))).toBe(true);
  f.get_post.mockClear();
  expect((await f.api.inject("/v1/posts/not-an-id/preview")).json().public).toBe(false);
  expect((await f.api.inject(`/v1/posts/${toBase64url(new Uint8Array(32))}/preview`)).json().public).toBe(false);
  expect(f.get_post).not.toHaveBeenCalled();
});
