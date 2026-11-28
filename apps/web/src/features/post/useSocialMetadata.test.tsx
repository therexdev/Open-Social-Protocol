import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { IndexerClient, PostPreviewView } from "../../api/indexer";
import { applySocialMetadata, useSocialMetadata } from "./useSocialMetadata";
const id = "a".repeat(43) + "=", path = `/post/${encodeURIComponent(id)}`;
let root: ReturnType<typeof createRoot> | undefined, box: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); box?.remove(); root = undefined; document.head.querySelectorAll("[data-osp-preview]").forEach(node => node.remove()); });
const meta = (name: string) => document.head.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`)?.content;
const preview: PostPreviewView = { version: 1, public: true, title: 'Rex "<testing>" on Open Social', description: "A public snippet", image: { path: `/v1/posts/${encodeURIComponent(id)}/preview/image?version=${"b".repeat(43)}=`, type: "image/jpeg", alt: "My picture" } };

it("updates Open Graph, X cards, title and canonical URL without interpreting markup", () => {
  applySocialMetadata(preview, id, "https://api.opensocial.online");
  expect(meta("og:title")).toBe(preview.title); expect(meta("twitter:description")).toBe("A public snippet");
  expect(meta("og:image")).toBe(`https://api.opensocial.online${preview.image!.path}`);
  expect(document.title).toBe(preview.title); expect(document.head.querySelector("testing")).toBeNull();
  expect(document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href).toBe(`https://opensocial.online${path}`);
  applySocialMetadata({ ...preview, public: false });
  expect(meta("og:description")).not.toContain("public snippet"); expect(meta("og:image")).toBe("https://opensocial.online/social-card.png");
});

it("clears post details on navigation and ignores a late response from the previous post", async () => {
  let resolve!: (value: PostPreviewView) => void;
  const indexer = { baseUrl: "https://api.opensocial.online", postPreview: vi.fn(() => new Promise<PostPreviewView>(done => { resolve = done; })) } as unknown as IndexerClient;
  function Page({ pathname }: { pathname: string }) { useSocialMetadata(pathname, indexer); return null; }
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
  await act(async () => root!.render(<Page pathname={path}/>));
  expect(indexer.postPreview).toHaveBeenCalledWith(id);
  await act(async () => root!.render(<Page pathname="/messages"/>));
  await act(async () => resolve(preview));
  expect(meta("og:title")).toBe("Open Social"); expect(meta("og:description")).not.toContain("public snippet");
  expect(meta("og:image")).toBe("https://opensocial.online/social-card.png");
});
