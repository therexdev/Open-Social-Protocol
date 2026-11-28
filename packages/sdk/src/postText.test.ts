import { expect, it, vi } from "vitest";
import { contentHash } from "./ids.js";
import { utf8, toBase64url } from "./encoding.js";
import { encryptContent, decryptContent, decodeEnvelope } from "./crypto/envelope.js";
import { createPostTextResolver, LONG_POST_FALLBACK, POST_TEXT_MAX_CHARACTERS, storePostText, validatePostText } from "./postText.js";

it.each([false, true])("round trips a 100,000-character post through a small authenticated envelope (private=%s)", async encrypted => {
  const text = "章".repeat(POST_TEXT_MAX_CHARACTERS), objects = new Map<string, Uint8Array>();
  const ref = await storePostText(text, encrypted, async bytes => {
    const url = `https://media.example/osp/network/identity/${toBase64url(contentHash(bytes))}`;
    objects.set(url, new Uint8Array(bytes)); return url;
  });
  const epochKey = new Uint8Array(32).fill(32), aad = new Uint8Array([1, 2, 3]);
  const sealed = encryptContent({ content: { version: 1, text: LONG_POST_FALLBACK, mime: "text/plain", text_ref: ref }, ...(encrypted && { epochKey, aad }) });
  expect(sealed.bytes.length).toBeLessThan(4096);
  const fetch = vi.fn(async (url: string | URL | Request) => new Response(new Uint8Array(objects.get(String(url))!)));
  const resolve = createPostTextResolver(fetch);
  const content = decryptContent({ envelope: sealed.bytes, ...(encrypted && { epochKey, aad }) });
  expect((await resolve(content, encrypted)).text).toBe(text);
  await resolve(content, encrypted); expect(fetch).toHaveBeenCalledOnce();
  if (encrypted) {
    expect(() => decryptContent({ envelope: sealed.bytes, aad, epochKey: new Uint8Array(32) })).toThrow();
    expect(new TextDecoder().decode(decodeEnvelope(sealed.bytes).payload)).not.toContain(JSON.parse(ref).key);
    expect(Buffer.from([...objects.values()][0]!).includes(Buffer.from(utf8(text.slice(0, 100))))).toBe(false);
  }
});

it("refuses excessive text and detects tampered or unavailable hosting without caching failures", async () => {
  expect(() => validatePostText("x".repeat(POST_TEXT_MAX_CHARACTERS))).not.toThrow();
  expect(() => validatePostText("x".repeat(POST_TEXT_MAX_CHARACTERS + 1))).toThrow("100,000");
  const text = "A complete short story. ".repeat(2000), bytes = utf8(text);
  const ref = await storePostText(text, false, async () => `https://media.example/osp/network/identity/${toBase64url(contentHash(bytes))}`);
  const fetch = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array(bytes.length).fill(1))).mockImplementation(async () => new Response(new Uint8Array(bytes)));
  const resolve = createPostTextResolver(fetch), content = { text: LONG_POST_FALLBACK, mime: "text/plain", text_ref: ref };
  await expect(resolve(content, false)).rejects.toThrow("fingerprint");
  expect((await resolve(content, false)).text).toBe(text);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]![1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
  await expect(resolve({ ...content, text_ref: ref.replace("https://", "http://") }, false)).rejects.toThrow("location");
  await expect(resolve({ ...content, text_ref: ref.replace('"size":', '"untrusted":true,"size":') }, false)).rejects.toThrow("reference");
});
