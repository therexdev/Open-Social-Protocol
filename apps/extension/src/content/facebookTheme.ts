export type FacebookTheme = "light" | "dark";
export function facebookTheme(doc: Document): FacebookTheme {
  const win = doc.defaultView, root = doc.documentElement;
  if (!win) return "light";
  const classes = `${root.className} ${doc.body?.className ?? ""}`;
  if (/\b__fb-dark-mode\b/.test(classes)) return "dark";
  if (/\b__fb-light-mode\b/.test(classes)) return "light";
  const style = win.getComputedStyle(root);
  const samples = [style.getPropertyValue("--card-background"), style.getPropertyValue("--web-wash"), doc.body && win.getComputedStyle(doc.body).backgroundColor, style.backgroundColor];
  for (const sample of samples) {
    if (!sample) continue;
    const hex = sample.trim().match(/^#([\da-f]{6})$/i);
    const rgb = sample.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?\s*\)$/);
    const color = hex ? [0, 2, 4].map(i => parseInt(hex[1]!.slice(i, i + 2), 16)) : rgb && (rgb[4] === undefined || Number(rgb[4]) > 0.5) ? rgb.slice(1, 4).map(Number) : undefined;
    if (color) return color[0]! * .2126 + color[1]! * .7152 + color[2]! * .0722 < 128 ? "dark" : "light";
  }
  return win.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function watchFacebookTheme(doc: Document, change: (theme: FacebookTheme) => void): () => void {
  let last: FacebookTheme | undefined, scheduled = false, alive = true;
  const sync = () => { scheduled = false; if (!alive) return; const next = facebookTheme(doc); if (next !== last) { last = next; change(next); } };
  const schedule = () => { if (!scheduled) { scheduled = true; setTimeout(sync, 0); } };
  const observer = new MutationObserver(schedule);
  for (const node of [doc.documentElement, doc.body]) if (node) observer.observe(node, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-mode"] });
  const media = doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", schedule); doc.addEventListener("visibilitychange", schedule); sync();
  return () => { alive = false; observer.disconnect(); media?.removeEventListener?.("change", schedule); doc.removeEventListener("visibilitychange", schedule); };
}
