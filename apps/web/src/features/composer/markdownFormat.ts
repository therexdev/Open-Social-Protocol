import { editMentionText, type MentionText } from "./mentionText";

export type MarkdownFormat = "bold" | "italic" | "heading" | "bullet" | "numbered" | "quote" | "link" | "code";

/** Edit the readable textarea while keeping the account targets of tagged people. */
export function formatMarkdown(value: MentionText, start: number, end: number, format: MarkdownFormat) {
  let next = value;
  const insert = (at: number, text: string) => { next = editMentionText(next, next.text.slice(0, at) + text + next.text.slice(at), at + text.length); };
  if (["heading", "bullet", "numbered", "quote"].includes(format)) {
    const lineStart = start === 0 ? 0 : value.text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = value.text.indexOf("\n", Math.max(start, end - 1));
    const lines = value.text.slice(lineStart, lineEnd < 0 ? value.text.length : lineEnd).split("\n");
    let at = lineStart, added = 0;
    lines.forEach((line, index) => {
      const prefix = format === "heading" ? "## " : format === "bullet" ? "- " : format === "numbered" ? `${index + 1}. ` : "> ";
      insert(at, prefix); at += prefix.length + line.length + 1; added += prefix.length;
    });
    return { value: next, start: start + (format === "numbered" ? 3 : format === "quote" || format === "bullet" ? 2 : 3), end: end + added };
  }
  if (format === "link") {
    const label = value.text.slice(start, end) || "link text", url = "https://example.com";
    const replacement = `[${label}](${url})`;
    next = editMentionText(next, next.text.slice(0, start) + replacement + next.text.slice(end), start + replacement.length);
    return { value: next, start: start + label.length + 3, end: start + label.length + 3 + url.length };
  }
  const mark = format === "bold" ? "**" : format === "italic" ? "*" : "`";
  if (start === end) { const label = format === "bold" ? "bold text" : format === "italic" ? "italic text" : "code"; insert(start, label); end += label.length; }
  insert(end, mark); insert(start, mark);
  return { value: next, start: start + mark.length, end: end + mark.length };
}
