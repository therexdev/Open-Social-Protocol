/** Exact supported host allowlists; content scripts and embedded cards receive no wildcard trust. */
export const FACEBOOK_ORIGINS = ["https://www.facebook.com/*", "https://web.facebook.com/*"];
export const X_ORIGINS = ["https://x.com/*", "https://www.x.com/*"];
export const FEED_ORIGINS = [...FACEBOOK_ORIGINS, ...X_ORIGINS].map(pattern => pattern.slice(0, -2));
export type FeedHost = "facebook" | "x";
export function feedHost(origin: string): FeedHost | undefined {
  if (FACEBOOK_ORIGINS.includes(`${origin}/*`)) return "facebook";
  if (X_ORIGINS.includes(`${origin}/*`)) return "x";
}
