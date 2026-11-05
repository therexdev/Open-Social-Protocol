import { FEED_ORIGINS, feedHost } from "../shared/hosts";
export function installCardTheme() {
  const params = new URLSearchParams(location.hash.slice(1)), host = params.get("host");
  const apply = (theme: unknown) => { if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme; };
  document.documentElement.dataset.host = feedHost(host || "") || "facebook";
  apply(params.get("theme") ?? "light");
  if (!FEED_ORIGINS.includes(host || "")) return;
  window.addEventListener("message", event => {
    if (event.source === parent && event.origin === host && event.data?.type === "osp.card.theme") apply(event.data.theme);
  });
}
