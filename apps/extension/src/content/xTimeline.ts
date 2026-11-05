import { FEED_ATTR, type FeedLocation } from "./feedCards";

/** Find only the main home timeline's cells, not quoted posts, sidebar suggestions or dialogs.
 * Stable status IDs identify recycled cells; DOM indexes cannot identify virtualized tweets. */
export function xTimelineLocator() {
  const positions = new Map<string, number>();
  let nextPosition = 0;
  return (doc: Document): FeedLocation | null => {
    if (!/^\/(?:home)?\/?$/.test(doc.location.pathname)) return null;
    const primary = doc.querySelector('[data-testid="primaryColumn"]');
    if (!primary) return null;
    const lanes = new Map<HTMLElement, FeedLocation>();
    for (const tweet of primary.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')) {
      if (tweet.closest(`[${FEED_ATTR}], [role="dialog"], [hidden], [aria-hidden="true"]`)) continue;
      const row = tweet.closest<HTMLElement>('[data-testid="cellInnerDiv"]'), column = row?.parentElement;
      if (!row || !column || row.querySelector('article[data-testid="tweet"]') !== tweet) continue;
      const links = [...tweet.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')];
      const permalink = links.find(a => a.querySelector('time'));
      // A timestamp permalink is required: never use a quoted post's or media-only URL.
      const match = permalink?.getAttribute('href')?.match(/^\/(?:[A-Za-z0-9_]+|i\/web)\/status\/(\d+)(?:[/?#]|$)/);
      if (!match) continue;
      const key = `x:${match[1]}`;
      if (!positions.has(key)) positions.set(key, ++nextPosition);
      let lane = lanes.get(column);
      if (!lane) { lane = { column, posts: [], keys: new Map(), positions: new Map() }; lanes.set(column, lane); }
      if ([...lane.keys.values()].includes(key)) continue;
      lane.posts.push(row); lane.keys.set(row, key); lane.positions.set(row, positions.get(key)!);
    }
    return [...lanes.values()].sort((a,b) => b.posts.length-a.posts.length)[0] ?? null;
  };
}

/** Grow every native measurement wrapper while keeping the card outside the tweet article. */
export const xRowContainer = (row: HTMLElement) => row.querySelector<HTMLElement>('article[data-testid="tweet"]')?.parentElement ?? row;
