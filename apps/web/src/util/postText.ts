export type TextPart =
  | { kind: "text"; text: string }
  | { kind: "url"; text: string; href: string }
  | { kind: "tag"; text: string; tag: string };

const tagCharacters = /^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*$/u;
export function normalizeTag(value: string): string | undefined {
  const tag = value.replace(/^#/, "").normalize("NFC").toLowerCase();
  return tagCharacters.test(tag) && [...tag].length <= 64 ? tag : undefined;
}
export const tagHref = (tag: string) => `/tags/${encodeURIComponent(tag)}`;

function trimUrl(value: string): string {
  let result = value;
  for (;;) {
    const before = result;
    result = result.replace(/[.,!?;:'"’”]+$/u, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      const count = (char: string) => [...result].filter(c => c === char).length;
      while (result.endsWith(close!) && count(close!) > count(open!)) result = result.slice(0, -1);
    }
    if (result === before) return result;
  }
}

/** Plain text only: URLs consume their fragments before hashtag matching. */
export function splitPostText(text: string): TextPart[] {
  const pattern = /https?:\/\/[^\s<>"\u0000-\u001f]+|www\.[^\s<>"\u0000-\u001f]+|#[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*/giu;
  const parts: TextPart[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const before = [...text.slice(0, start)].at(-1) ?? "";
    if (/[\p{L}\p{M}\p{N}_@#]/u.test(before)) continue;
    let part: TextPart | undefined;
    if (match[0].startsWith("#")) {
      const tag = normalizeTag(match[0]);
      if (tag) part = { kind: "tag", text: match[0], tag };
    } else {
      const label = trimUrl(match[0]);
      try {
        const url = new URL(/^www\./i.test(label) ? `https://${label}` : label);
        if ((url.protocol === "https:" || url.protocol === "http:") && url.hostname)
          part = { kind: "url", text: label, href: url.href };
      } catch { /* Malformed addresses remain ordinary text. */ }
    }
    if (!part) continue;
    if (start > offset) parts.push({ kind: "text", text: text.slice(offset, start) });
    parts.push(part);
    offset = start + part.text.length;
  }
  if (offset < text.length) parts.push({ kind: "text", text: text.slice(offset) });
  return parts;
}

export function hasHashtag(text: string, tag: string): boolean {
  const normalized = normalizeTag(tag);
  return !!normalized && splitPostText(text).some(p => p.kind === "tag" && p.tag === normalized);
}
