import { isAddress } from "@osp/sdk";

/** Portable text convention: the label is presentation; the account is the target. */
export const mentionPattern = String.raw`@\[((?:\\[\\\]]|[^\]\\\r\n]){1,160})\]\(osp:([1-9A-HJ-NP-Za-km-z]{25,35})\)`;
const exactMention = new RegExp(`^${mentionPattern}$`, "u");

export function mentionName(name: string, account: string): string {
  return [...name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()].slice(0, 80).join("") || account;
}

export function encodeMention(name: string, account: string): string {
  if (!isAddress(account)) throw new Error("Invalid mention account");
  return `@[${mentionName(name, account).replace(/[\\\]]/g, "\\$&")}](osp:${account})`;
}

export function parseMention(text: string): { name: string; account: string } | undefined {
  const match = exactMention.exec(text);
  if (!match || !isAddress(match[2]!)) return undefined;
  const name = match[1]!.replace(/\\([\\\]])/g, "$1");
  return name.trim() ? { name, account: match[2]! } : undefined;
}
