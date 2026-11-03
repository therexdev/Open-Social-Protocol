import { describe, expect, it } from "vitest";
import { Signer } from "@osp/sdk";
import { encodeMention, parseMention } from "../../util/mentions";
import { splitPostText } from "../../util/postText";
import { editMentionText, findMentionQuery, insertMention, readMentionText, writeMentionText } from "./mentionText";

const alice = Signer.fromSeed("mention-test-alice").getAddress();
const other = Signer.fromSeed("mention-test-other").getAddress();
const plain = (text: string) => ({ text, mentions: [] });

describe("account-bound mentions", () => {
  it("round-trips duplicate and escaped names without losing account identities", () => {
    const names = ["Alex Kim", "Alex Kim", "Zoë [work] \\ café"];
    const serialized = names.map((name, i) => encodeMention(name, i === 1 ? other : alice)).join(" and ");
    const draft = readMentionText(serialized);
    expect(draft.text).toBe(names.map(name => `@${name}`).join(" and "));
    expect(draft.mentions.map(m => m.account)).toEqual([alice, other, alice]);
    expect(writeMentionText(draft)).toBe(serialized);
  });

  it("accepts valid accounts only and does not interpret emails, URLs or bare names as tags", () => {
    expect(parseMention("@[Alex](osp:not-an-address)")).toBeUndefined();
    expect(parseMention("@[Alex](javascript:alert(1))")).toBeUndefined();
    expect(() => encodeMention("Alex", "not-an-address")).toThrow();
    const text = `user@example.org @Alex https://example.org/${encodeMention("Alex", alice)}`;
    expect(splitPostText(text).some(part => part.kind === "mention")).toBe(false);
  });

  it("keeps linked names through edits on either side and removes links only when the name is edited", () => {
    const initial = readMentionText(`Hello ${encodeMention("Alex Kim", alice)} and ${encodeMention("Sam", other)}.`);
    const prefixed = editMentionText(initial, `New: ${initial.text}!`);
    // Two separated edits are intentionally treated as replacing the intervening range.
    expect(prefixed.mentions).toHaveLength(0);
    const before = editMentionText(initial, `New: ${initial.text}`);
    expect(before.mentions.map(m => m.account)).toEqual([alice, other]);
    const after = editMentionText(before, `${before.text}!`);
    expect(after.mentions.map(m => m.account)).toEqual([alice, other]);
    const renamed = editMentionText(after, after.text.replace("Alex", "Alec"));
    expect(renamed.mentions.map(m => m.account)).toEqual([other]);
    expect(writeMentionText(renamed)).toContain("@Alec Kim");
    expect(writeMentionText(renamed)).not.toContain(alice);
    const removed = editMentionText(initial, initial.text.replace("@Alex Kim and ", ""));
    expect(removed.mentions.map(m => m.account)).toEqual([other]);
    expect(readMentionText(writeMentionText(removed)).text).toBe(removed.text);
  });

  it("uses the caret to distinguish deletion of identical names bound to different accounts", () => {
    const initial = readMentionText(`${encodeMention("Alex", alice)} ${encodeMention("Alex", other)}`);
    expect(editMentionText(initial, "@Alex", 0).mentions.map(m => m.account)).toEqual([other]);
    expect(editMentionText(initial, "@Alex", 5).mentions.map(m => m.account)).toEqual([alice]);
    expect(editMentionText(initial, initial.text, 2)).toEqual(initial);
  });

  it("keeps the readable target when whitespace before the name is deleted", () => {
    const initial = readMentionText(`Hello ${encodeMention("Alex", alice)}`);
    const edited = editMentionText(initial, "Hello@Alex", 5);
    expect(readMentionText(writeMentionText(edited))).toEqual(edited);
    expect(edited.mentions[0]?.account).toBe(alice);
  });
});

describe("mention completion at the cursor", () => {
  it.each(["@", "Hello @Al", "Hi (@Zoë", "Line one\n@Alex Ki", "@東京", "@Alex ", "@L33T US€R", "@Sam 👩‍💻", "@Jean–Paul"])("opens at %s", text => {
    expect(findMentionQuery(plain(text), text.length)).toBeDefined();
  });
  it.each(["person@example.org", "https://host/@Al", "word@Al", "@@Al", "@Al\n", "@Al\t", "@Al!", "@" + "a".repeat(65)])("does not open at %s", text => {
    expect(findMentionQuery(plain(text), text.length)).toBeUndefined();
  });
  it("ignores selected text and completed mentions, and replaces only the current unfinished word", () => {
    expect(findMentionQuery(plain("@Al"), 1, 3)).toBeUndefined();
    const tagged = readMentionText(encodeMention("Alex Kim", alice));
    expect(findMentionQuery(tagged, 4)).toBeUndefined();
    const draft = readMentionText(`Hi @Alex, meet ${encodeMention("Sam", other)}!`);
    const query = findMentionQuery(draft, 6)!;
    const next = insertMention(draft, query, { name: "Alex Kim", account: alice });
    expect(next.value.text).toBe("Hi @Alex Kim, meet @Sam!");
    expect(next.caret).toBe("Hi @Alex Kim".length);
    expect(next.value.mentions.map(m => m.account)).toEqual([alice, other]);
    expect(readMentionText(writeMentionText(next.value))).toEqual(next.value);
  });
});
