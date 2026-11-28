import { fromMarkdown } from "mdast-util-from-markdown";
import type { Root, RootContent } from "mdast";
import { mentionPattern, parseMention } from "./mentions";

export type TextPart =
  | { kind: "text"; text: string }
  | { kind: "url"; text: string; href: string }
  | { kind: "tag"; text: string; tag: string }
  | { kind: "mention"; text: string; name: string; account: string };

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

/** Plain text only: URLs consume their fragments before tag/mention matching. */
export function splitPostText(text: string): TextPart[] {
  const pattern = new RegExp(String.raw`https?:\/\/[^\s<>"\u0000-\u001f]+|www\.[^\s<>"\u0000-\u001f]+|${mentionPattern}|#[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*`, "giu");
  const parts: TextPart[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const before = [...text.slice(0, start)].at(-1) ?? "";
    // Explicit account links survive removing whitespace beside a selected name.
    if (!match[0].startsWith("@") && /[\p{L}\p{M}\p{N}_@#]/u.test(before)) continue;
    let part: TextPart | undefined;
    if (match[0].startsWith("@")) {
      const mention = parseMention(match[0]);
      if (mention) part = { kind: "mention", text: match[0], ...mention };
    } else if (match[0].startsWith("#")) {
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

/** Match visible Markdown text, excluding code, raw HTML and explicit link labels. */
export function extractHashtags(text: string): string[] {
  const tags = new Set<string>();
  const walk = (node: Root | RootContent) => {
    if (["code", "inlineCode", "html", "link", "linkReference", "image", "imageReference"].includes(node.type)) return;
    if (node.type === "text") for (const part of splitPostText(node.value)) if (part.kind === "tag") tags.add(part.tag);
    if ("children" in node) for (const child of node.children) walk(child);
  };
  walk(fromMarkdown(text)); return [...tags];
}
export function hasHashtag(text: string, tag: string): boolean {
  const normalized = normalizeTag(tag);
  return !!normalized && extractHashtags(text).includes(normalized);
}
