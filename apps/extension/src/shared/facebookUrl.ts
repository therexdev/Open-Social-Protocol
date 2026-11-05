/** Only published-post permalinks, never the home feed, a profile or a redirect. */
export const FACEBOOK_LINK_BYTES = 512;
export function facebookPostUrl(value: string): string | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return; }
  if (url.protocol !== "https:" || !["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"].includes(url.hostname) || url.username || url.password || url.port || url.searchParams.has("comment_id") || url.searchParams.has("reply_comment_id")) return;
  const id = /^[A-Za-z0-9._-]+$/;
  const path = url.pathname.replace(/\/+$/, "");
  if (/^\/(?:[A-Za-z0-9._-]+\/posts\/[A-Za-z0-9._-]+|groups\/[A-Za-z0-9._-]+\/(?:posts|permalink)\/[A-Za-z0-9._-]+|reel\/[A-Za-z0-9._-]+)$/.test(path)) {
    const link = `https://www.facebook.com${path}`;
    return link.length <= FACEBOOK_LINK_BYTES ? link : undefined;
  }
  const result = new URL(`https://www.facebook.com${path || "/"}`);
  const keys = ["/permalink.php", "/story.php"].includes(path) ? ["story_fbid", "id"] : ["/photo.php", "/photo"].includes(path) ? ["fbid"] : path === "/watch" ? ["v"] : undefined;
  if (!keys || keys.some(key => !id.test(url.searchParams.get(key) || ""))) return;
  for (const key of keys) result.searchParams.set(key, url.searchParams.get(key)!);
  return result.href.length <= FACEBOOK_LINK_BYTES ? result.href : undefined;
}
