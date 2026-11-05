export const X_LINK_BYTES = 160;
/** Published status links only; no profile, compose, intent, media subpath or credential URLs. */
export function xPostUrl(value: string): string | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return; }
  if (url.protocol !== "https:" || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname) || url.username || url.password || url.port) return;
  const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15}|i\/web)\/status\/([1-9]\d{0,24})\/?$/);
  if (!match) return;
  return `https://x.com/${match[1]!.toLowerCase()}/status/${match[2]}`;
}
