import { describe, expect, it } from "vitest";
import { hasHashtag, normalizeTag, splitPostText, tagHref } from "./postText";

describe("URLs and hashtags in plain text", () => {
  it("preserves text, line breaks and punctuation while linking URLs and Unicode tags", () => {
    const text = "Read (https://example.org/wiki/Topic_(one)).\nSee www.example.com/path?q=1&x=2! #OpenSocial #CAFÉ #東京 #2026";
    const parts = splitPostText(text);
    expect(parts.map(part => part.text).join("")).toBe(text);
    expect(parts.filter(part => part.kind === "url").map(part => part.href)).toEqual([
      "https://example.org/wiki/Topic_(one)", "https://www.example.com/path?q=1&x=2",
    ]);
    expect(parts.filter(part => part.kind === "tag").map(part => part.tag)).toEqual(["opensocial", "café", "東京", "2026"]);
    expect(hasHashtag("#Cafe\u0301", "CAFÉ")).toBe(true);
    expect(tagHref("café")).toBe("/tags/caf%C3%A9");
  });
  it("does not turn URL fragments, email fragments, or partial tags into tag matches", () => {
    expect(hasHashtag("https://example.com/#topic", "topic")).toBe(false);
    expect(hasHashtag("name@example.com#topic word#topic ##topic #topic_more", "topic")).toBe(false);
    expect(hasHashtag("#Topics #topic", "TOPIC")).toBe(true);
  });
  it("accepts only web URLs and bounded hashtag names", () => {
    expect(splitPostText("javascript:alert(1) data:text/html,evil <img onerror=alert(1)> ftp://host/path").every(part => part.kind === "text")).toBe(true);
    expect(normalizeTag("a".repeat(65))).toBeUndefined();
    expect(normalizeTag("hello/world")).toBeUndefined();
    expect(normalizeTag("#Good_Tag")).toBe("good_tag");
  });
});
