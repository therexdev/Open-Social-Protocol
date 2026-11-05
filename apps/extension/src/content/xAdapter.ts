import { FeedController, FEED_ATTR, feedCardNeedsRepair, type FeedCardsRuntime } from "./feedCards";
import { xTimelineLocator, xRowContainer } from "./xTimeline";
import { X_ORIGINS } from "../shared/hosts";

/** Feed only: never inspects composers, DMs or account credentials, and never submits X posts. */
export function startXAdapter(runtime: FeedCardsRuntime = { document, sendMessage: m => chrome.runtime.sendMessage(m) }) {
  const doc = runtime.document, win = doc.defaultView;
  if (!win || !X_ORIGINS.includes(`${doc.location.origin}/*`)) return;
  let alive = true, timer: ReturnType<typeof setTimeout> | undefined, lastView = "";
  let controller: FeedController | undefined;
  const scan = () => {
    timer = undefined; if (!alive || doc.visibilityState === "hidden") return;
    const selected = doc.querySelector('[data-testid="primaryColumn"] [role="tablist"] [role="tab"][aria-selected="true"]');
    const view = `${doc.location.pathname}${doc.location.search}:${selected?.textContent ?? ""}`;
    if (view !== lastView) { controller?.stop(); controller = undefined; lastView = view; }
    if (!/^\/(?:home)?\/?$/.test(doc.location.pathname)) return;
    controller ??= new FeedController({ ...runtime, insideRow: true, rowContainer: xRowContainer, findLocation: xTimelineLocator() });
    void controller.scan(true);
  };
  const schedule = () => { if (alive && !timer) timer = setTimeout(scan, 120); };
  const observer = new MutationObserver(records => {
    if (records.some(r => {
      const target = r.target instanceof Element ? r.target : r.target.parentElement;
      if (target?.closest(`[${FEED_ATTR}]`)) return false;
      if (r.type === "attributes") return !!target?.matches('[data-testid="cellInnerDiv"], [role="tab"]');
      return [...r.addedNodes, ...r.removedNodes].some(n => n instanceof Element &&
        (n.matches(`[${FEED_ATTR}]`) ? feedCardNeedsRepair(n) : !n.closest(`[${FEED_ATTR}]`)));
    })) schedule();
  });
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected", "style"] });
  win.addEventListener("popstate", schedule); win.addEventListener("focus", schedule);
  doc.addEventListener("visibilitychange", schedule);
  const navigationTimer = setInterval(schedule, 1500); // SPA history can change without a popstate event.
  scan();
  return {
    refresh() { controller?.stop(); controller = undefined; schedule(); },
    stop() { alive = false; clearTimeout(timer); clearInterval(navigationTimer); observer.disconnect(); controller?.stop();
      win.removeEventListener("popstate", schedule); win.removeEventListener("focus", schedule); doc.removeEventListener("visibilitychange", schedule); },
  };
}
