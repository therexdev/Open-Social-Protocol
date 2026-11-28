import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ProtocolClient, Signer, contentHash, contentReference, encodeContentReference, encryptContent, hostedFileLocation, photoLocation, toBase64url, utf8 } from "@osp/sdk";
import { App, type AppProps } from "./App";
import { IndexerClient, type PostView } from "./api/indexer";
import { configureMediaStorage } from "./api/mediaStorage";
import { fakeIndexerFetch, fakeProvider, fixtureDeployment } from "./testing/fixtures";
import { createVaultStore } from "./vault/store";
import { memoryStorage } from "./vault/storage";
import { unsupportedPasskey } from "./vault/passkey";

let root: Root, host: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("lets a fresh visitor read R2 posts, public comments and media, follow timestamps, and keeps private content locked", async () => {
  const deployment = { ...fixtureDeployment("mainnet"), economy: "token-free" as const }, provider = fakeProvider();
  const protocol = new ProtocolClient({ deployment, rpc: provider }), author = Signer.fromSeed("public-story-author").getAddress();
  const objects = new Map<string, Uint8Array>(), calls: string[] = [];
  const put = (bytes: Uint8Array) => { const hash = toBase64url(contentHash(bytes)); objects.set(hash, bytes); return `https://media.test/osp/fixture/${hash}`; };
  const pixels = utf8("verified public photo bytes"), photoId = new Uint8Array(32).fill(51), photoUrl = put(pixels);
  const videoBytes = utf8("video fixture"), audioBytes = utf8("audio fixture");
  const media = [
    { content_hash: contentHash(pixels), mime: "image/jpeg", size: String(pixels.length), locations: [photoLocation(deployment.contracts.publications.address, photoId)], alt_text: "Public image" },
    ...[[videoBytes,"video/mp4"],[audioBytes,"audio/mpeg"]].map(([bytes,mime]) => ({ content_hash: contentHash(bytes as Uint8Array), mime: mime as string, size: String((bytes as Uint8Array).length), locations: [hostedFileLocation(put(bytes as Uint8Array), contentHash(bytes as Uint8Array))] })),
  ];
  const make = (n: number, text: string, replyTo = "", privatePost = false): PostView => {
    const sealed = encryptContent({ content: { version: 1, text, mime: "text/plain", ...(n === 1 && { media }) }, ...(privatePost && { epochKey: new Uint8Array(32).fill(9), aad: { chainId: deployment.chainId, author, audience: 1, epoch: 1, versionNumber: 1 } }) });
    put(sealed.bytes);
    return { postId: toBase64url(new Uint8Array(32).fill(n)), author, sequence: String(n), contentHash: toBase64url(sealed.contentHash), envelope: toBase64url(encodeContentReference(contentReference(sealed.bytes))), audience: privatePost ? 1 : 0, audienceId: "", epoch: privatePost ? 1 : 0,
      state: 0, stateReason: "", replacementId: "", previousVersion: "", replyTo, versionNumber: 1, createdAt: String(Date.now()-180000), updatedAt: "0", txId: "fixture", blockHeight: "100", versions: [], labels: [], media: [], reactions: { total: 3, byType: { "1": 3 } }, replyCount: n === 1 ? 1 : 0 };
  };
  const post = make(1, "## Public story\n\n**Welcome** to the public feed.\n\n" + "A paragraph in the story. ".repeat(40));
  const reply = make(2, "A **public comment**.", post.postId), secret = make(3, "PRIVATE SECRET", "", true);
  const posts = [post, reply, secret];
  vi.spyOn(protocol.reads.publications, "get_post").mockImplementation(async (args) => {
    const post_id = args!.post_id;
    const p = posts.find(p => p.postId === toBase64url(post_id));
    return { value: p && { author: p.author, reply_to: p.replyTo ? new Uint8Array(32).fill(1) : new Uint8Array(), audience: p.audience, state: 0, version_count: 1, latest_version: contentHash(objects.get(p.contentHash)!) } } as never;
  });
  vi.spyOn(protocol.reads.publications, "get_photo").mockResolvedValue({ value: { external_uri: photoUrl, size: pixels.length } } as never);
  const storageFetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/v1/media")) return new Response(JSON.stringify({ enabled: true, provider: "r2", chainId: deployment.chainId, contract: deployment.contracts.identity.address, publicUrl: "https://media.test" }));
    const bytes = objects.get(url.split("/").at(-1)!); if (!bytes) throw Error("Unexpected fixture fetch " + url);
    return new Response(new Uint8Array(bytes));
  });
  vi.stubGlobal("fetch", storageFetch); vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("URL", class extends URL { static override createObjectURL = vi.fn(() => "blob:public-photo"); static override revokeObjectURL = vi.fn(); });
  configureMediaStorage(protocol, "https://sponsor.test/v1/media", storageFetch);
  const indexer = new IndexerClient({ baseUrl: "https://indexer.test", contentLoader: protocol.contracts.contentLoader, fetch: fakeIndexerFetch({
    "/v2/feed": { items: [post], nextCursor: null },
    ...Object.fromEntries(posts.map(p => [`/v1/posts/${encodeURIComponent(p.postId)}`, p])),
    [`/v1/posts/${encodeURIComponent(post.postId)}/replies`]: { items: [reply], nextCursor: null },
    [`/v1/posts/${encodeURIComponent(reply.postId)}/replies`]: { items: [], nextCursor: null },
    [`/v1/posts/${encodeURIComponent(secret.postId)}/replies`]: { items: [], nextCursor: null },
  }, calls) });
  const services: AppProps["services"] = resolved => ({ resolved: { ...resolved, network: "mainnet", deployed: true, deployment, chainId: deployment.chainId, indexerUrl: "https://indexer.test", sponsorUrls: ["https://sponsor.test"] }, protocol, indexer });
  const vault = createVaultStore({ storage: memoryStorage(), passkey: unsupportedPasskey });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><App vault={vault} services={services}/></MemoryRouter>));
  await vi.waitFor(() => expect(host.querySelector(".post-markdown h2")?.textContent).toBe("Public story"));
  expect(calls.some(c => c.startsWith("/v2/feed?") && c.includes("scope=public"))).toBe(true);
  expect(calls.some(c => c.includes("viewer="))).toBe(false);
  expect(host.querySelector(".welcome-page")).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="React"]')?.disabled).toBe(true);
  await act(async () => host.querySelector<HTMLAnchorElement>(".post-permalink")!.click());
  await vi.waitFor(() => expect(host.textContent).toContain("public comment"));
  expect(host.querySelector(".replies-card strong")?.textContent).toBe("public comment");
  expect(host.querySelector(".post-text-preview")).not.toBeNull(); // Comment previews stay compact.
  expect(host.querySelector(".post-page > article .post-text-preview")).toBeNull();
  await vi.waitFor(() => expect(host.querySelector('img[alt="Public image"]')?.getAttribute("src")).toBe("blob:public-photo"));
  await vi.waitFor(() => expect(host.querySelector("video")?.src).toContain("https://media.test/osp/"));
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.includes("Play voice message"))!.click());
  await vi.waitFor(() => expect(host.querySelector("audio")?.src).toContain("https://media.test/osp/"));
  // A direct private post link cannot expose its text to the same visitor.
  await act(async () => root.render(<MemoryRouter key="private" initialEntries={[`/post/${secret.postId}`]}><App vault={vault} services={services}/></MemoryRouter>));
  await vi.waitFor(() => expect(host.textContent).toContain("Unlock your account to read private posts"));
  expect(host.textContent).not.toContain("PRIVATE SECRET");
  expect(vault.getState().status).toBe("empty"); expect(vault.getState().account).toBeUndefined(); expect(provider.sent).toHaveLength(0);
});
