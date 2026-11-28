import { safeEditorLink } from "./richEditorSchema";

/** Keep document structure and Markdown-compatible marks, discarding active or
 * hidden clipboard content before ProseMirror applies its allowlisted schema. */
export function cleanPastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll('script,style,iframe,object,embed,svg,math,img,video,audio,source,link,meta,form,input,button,template,[hidden],[aria-hidden="true"]').forEach(el => el.remove());
  for (const el of doc.body.querySelectorAll<HTMLElement>("*")) {
    if (el.style.display === "none" || el.style.visibility === "hidden") { el.remove(); continue; }
    if (el.tagName === "A" && !safeEditorLink(el.getAttribute("href") ?? "")) el.removeAttribute("href");
    for (const attr of [...el.attributes]) if (attr.name.startsWith("on") || ["src", "srcset", "background", "contenteditable"].includes(attr.name)) el.removeAttribute(attr.name);
  }
  // Word often puts list items in paragraphs with a decorative marker span.
  let list: HTMLOListElement | HTMLUListElement | undefined, previous: Element | undefined;
  for (const p of [...doc.body.querySelectorAll<HTMLElement>('p[style*="mso-list"]')]) {
    if (!/mso-list:\s*l\d+\s+level\d+/i.test(p.getAttribute("style") ?? "")) continue;
    const marker = [...p.querySelectorAll<HTMLElement>("span")].find(el => /mso-list:\s*Ignore/i.test(el.getAttribute("style") ?? ""));
    const raw = marker?.textContent?.trim() ?? "", numbered = /^\d+[.)]/.test(raw);
    marker?.remove();
    const tag = numbered ? "OL" : "UL";
    if (!list || list.tagName !== tag || p.previousElementSibling !== previous) {
      list = doc.createElement(numbered ? "ol" : "ul");
      const start = numbered ? Number.parseInt(raw, 10) : 1;
      if (numbered && start > 1) list.setAttribute("start", String(start));
      p.before(list);
    }
    const li = doc.createElement("li"); while (p.firstChild) li.append(p.firstChild); list.append(li); p.remove(); previous = list;
  }
  return doc.body.innerHTML;
}
