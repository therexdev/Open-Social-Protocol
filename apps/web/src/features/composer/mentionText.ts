import { splitPostText } from "../../util/postText";
import { encodeMention, mentionName } from "../../util/mentions";

export interface MentionRange { start: number; end: number; name: string; account: string }
export interface MentionText { text: string; mentions: MentionRange[] }
export interface MentionQuery { start: number; end: number; query: string }

/** Keep names readable in the editor while preserving account targets in saved drafts. */
export function readMentionText(value: string): MentionText {
  let text = "";
  const mentions: MentionRange[] = [];
  for (const part of splitPostText(value)) {
    if (part.kind === "mention") {
      const label = `@${part.name}`;
      mentions.push({ start: text.length, end: text.length + label.length, name: part.name, account: part.account });
      text += label;
    } else text += part.text;
  }
  return { text, mentions };
}

export function writeMentionText(value: MentionText): string {
  let text = "", offset = 0;
  for (const mention of value.mentions) {
    text += value.text.slice(offset, mention.start) + encodeMention(mention.name, mention.account);
    offset = mention.end;
  }
  return text + value.text.slice(offset);
}

/** Editing any part of a selected name removes that target, never retargets by name. */
export function editMentionText(value: MentionText, text: string, caret?: number): MentionText {
  if (value.text === text) return value;
  const delta = text.length - value.text.length;
  let oldEnd = value.text.length, newEnd = text.length;
  // The native caret disambiguates edits between repeated names/characters.
  if (caret !== undefined && caret >= 0 && caret <= text.length && caret - delta >= 0 && caret - delta <= value.text.length && value.text.slice(caret - delta) === text.slice(caret)) {
    oldEnd = caret - delta; newEnd = caret;
  } else {
    while (oldEnd > 0 && newEnd > 0 && value.text[oldEnd - 1] === text[newEnd - 1]) { oldEnd--; newEnd--; }
  }
  let start = 0;
  while (start < oldEnd && start < newEnd && value.text[start] === text[start]) start++;
  return { text, mentions: value.mentions.flatMap(mention => {
    if (mention.end <= start) return [mention];
    if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
    return [];
  }) };
}

export function findMentionQuery(value: MentionText, start: number, end = start): MentionQuery | undefined {
  if (start !== end || start < 0 || start > value.text.length || value.mentions.some(m => start > m.start && start <= m.end)) return undefined;
  const before = value.text.slice(0, start);
  // A standalone @ can follow whitespace or opening punctuation, never an email or URL.
  const match = /(?:^|[\s([{"'“‘])@([^@\r\n\t]*)$/u.exec(before);
  if (!match) return undefined;
  const query = match[1]!;
  if (query.length > 64 || (query && (!/^[\p{L}\p{M}\p{N}_.’' -]+$/u.test(query) || /\s$/.test(query)))) return undefined;
  return { start: start - query.length - 1, end: start, query };
}

export function insertMention(value: MentionText, query: MentionQuery, person: { name: string; account: string }): { value: MentionText; caret: number } {
  const name = mentionName(person.name, person.account), label = `@${name}`;
  // Replace the remaining word when the caret is inside an unfinished @name.
  const suffix = value.text.slice(query.end);
  const tail = /^[\p{L}\p{M}\p{N}_’'-]*/u.exec(suffix)![0];
  const end = query.end + tail.length;
  const space = !value.text[end] || !/[\s.,!?;:)}\]]/u.test(value.text[end]!) ? " " : "";
  const replacement = label + space;
  const text = value.text.slice(0, query.start) + replacement + value.text.slice(end);
  const delta = replacement.length - (end - query.start);
  const mentions = value.mentions.flatMap(mention => {
    if (mention.end <= query.start) return [mention];
    if (mention.start >= end) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
    return [];
  });
  mentions.push({ start: query.start, end: query.start + label.length, name, account: person.account });
  mentions.sort((a, b) => a.start - b.start);
  return { value: { text, mentions }, caret: query.start + replacement.length };
}
