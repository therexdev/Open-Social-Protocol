import { useEffect } from "react";
import type { IndexerClient, PostPreviewView } from "../../api/indexer";

const site = (import.meta.env.VITE_OSP_PUBLIC_SITE_URL || "https://opensocial.online").replace(/\/+$/, "");
const description = "Your people. Your world. Connect and share on Open Social.";

/** SPA navigation mirrors the initial HTML card; private decrypted text is never used. */
export function applySocialMetadata(preview?: PostPreviewView, id?: string, api = ""): void {
  const publicPost = preview?.public === true && preview.version === 1 && typeof preview.title === "string" && typeof preview.description === "string" && !!id;
  const title = publicPost ? preview.title : "Open Social";
  const text = publicPost ? preview.description : description;
  const canonical = publicPost ? `${site}/post/${encodeURIComponent(id!)}` : `${site}/`;
  const attachment = publicPost && preview.image && new RegExp(`^/v1/posts/${encodeURIComponent(id!)}/preview/image\\?version=[A-Za-z0-9_-]{43}=?$`).test(preview.image.path) ? preview.image : undefined;
  const image = attachment ? `${api.replace(/\/+$/, "")}${attachment.path}` : `${site}/social-card.png`;
  const alt = attachment?.alt ?? "Open Social — Your people. Your world.";
  const set = (key: string, value: string, property = false) => {
    const attribute = property ? "property" : "name";
    let node = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
    if (!node) { node = document.createElement("meta"); node.setAttribute(attribute, key); document.head.append(node); }
    node.setAttribute("data-osp-preview", ""); node.content = value;
  };
  set("description", text);
  for (const [key, value] of Object.entries({ "og:site_name": "Open Social", "og:type": publicPost ? "article" : "website", "og:title": title, "og:description": text, "og:url": canonical,
    "og:image": image, "og:image:secure_url": image, "og:image:type": attachment?.type ?? "image/png", "og:image:alt": alt })) set(key, value, true);
  for (const [key, value] of Object.entries({ "twitter:card": "summary_large_image", "twitter:title": title, "twitter:description": text, "twitter:image": image, "twitter:image:alt": alt })) set(key, value);
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.append(link); }
  link.href = canonical; link.setAttribute("data-osp-preview", "");
  if (publicPost) document.title = title;
}

export function useSocialMetadata(pathname: string, indexer: IndexerClient): void {
  useEffect(() => {
    let active = true;
    applySocialMetadata();
    const match = /^\/post\/([A-Za-z0-9_-]{43}(?:=|%3[dD])?)\/?$/.exec(pathname)?.[1];
    const id = match ? decodeURIComponent(match).replace(/=+$/, "") + "=" : undefined;
    if (id && typeof indexer.postPreview === "function") {
      void indexer.postPreview(id).then(preview => { if (active) applySocialMetadata(preview, id, indexer.baseUrl); }).catch(() => { /* Older/offline API keeps the generic card. */ });
    }
    return () => { active = false; applySocialMetadata(); };
  }, [pathname, indexer]);
}
