export function installCardTheme() {
  const params = new URLSearchParams(location.hash.slice(1)), host = params.get("host");
  const apply = (theme: unknown) => { if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme; };
  apply(params.get("theme") ?? "light");
  if (!["https://www.facebook.com", "https://web.facebook.com"].includes(host || "")) return;
  window.addEventListener("message", event => {
    if (event.source === parent && event.origin === host && event.data?.type === "osp.card.theme") apply(event.data.theme);
  });
}
