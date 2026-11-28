import { expect, it, vi } from "vitest";
import { contentReference, contentReferenceUri, createContentLoader, encodeContentReference, hydrateContent, parseContentReference, parseContentReferenceUri } from "./contentStorage.js";
import { encryptMedia } from "./media.js";
import { contentHash } from "./ids.js";
import { toBase64url, utf8 } from "./encoding.js";

it("round trips compact references to exact original ciphertext and rejects malformed sizes", () => {
  const bytes = encryptMedia(utf8("private message")).ciphertext, ref = contentReference(bytes);
  expect(encodeContentReference(ref)).toHaveLength(44);
  expect(parseContentReference(encodeContentReference(ref))).toEqual(ref);
  expect(parseContentReferenceUri(contentReferenceUri(ref))).toEqual(ref);
  expect(parseContentReference(bytes)).toBeUndefined();
  expect(() => parseContentReference(encodeContentReference(ref).slice(0, 43))).toThrow();
  const invalid = encodeContentReference(ref); invalid.fill(255, 8, 12);
  expect(() => parseContentReference(invalid)).toThrow();
  expect(() => parseContentReferenceUri("osp:content:v1:0:" + "a".repeat(64))).toThrow();
});
it("uses the R2 content-addressed namespace, checks size/hash and never caches a failed download", async () => {
  const bytes = utf8("hello"), ref = contentReference(bytes);
  const fetchFn = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array(utf8("wrong")))).mockImplementation(async () => new Response(new Uint8Array(bytes)));
  const load = createContentLoader({ publicUrl: "https://media.example", chainId: "AQIDBA==", identityContract: "identity", fetch: fetchFn });
  await expect(load(ref)).rejects.toThrow("fingerprint");
  expect(await load(ref)).toEqual(bytes);
  expect(await load(ref)).toEqual(bytes);
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(fetchFn.mock.calls[0]).toEqual([`https://media.example/osp/QVFJREJBPT0/identity/${toBase64url(ref.digest)}`, expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" })]);
});
it("restores legacy shapes but cannot hydrate ledger permissions, poll votes or music prices", async () => {
  const documents = new Map<string, Uint8Array>();
  function store(bytes: Uint8Array) { const ref = contentReference(bytes); documents.set(toBase64url(ref.digest), bytes); return ref; }
  const envelope = encryptMedia(utf8("private post")).ciphertext, body = store(envelope);
  const metadata = store(utf8(JSON.stringify({ title: "Music", artist: "Artist", description: "Description", owner: "attacker", price: "0" })));
  const poll = store(utf8(JSON.stringify({ question: "Choose?", options: ["A", "B"], counts: [100, 0], closes_at: "0" })));
  const original = { envelope: encodeContentReference(body), title: contentReferenceUri(metadata), owner: "author", price: "100", poll: { question: contentReferenceUri(poll), options: ["0", "1"], closes_at: "500", counts: [2, 3] } };
  const hydrated = await hydrateContent(original, async ref => documents.get(toBase64url(ref.digest))!);
  expect(hydrated).toMatchObject({ envelope, title: "Music", artist: "Artist", owner: "author", price: "100", poll: { question: "Choose?", options: ["A", "B"], closes_at: "500", counts: [2, 3] } });
  expect(original.envelope).toHaveLength(44);
  expect(contentHash(hydrated.envelope)).toEqual(body.digest);
});
it("keeps unavailable references for retry without preventing unrelated ledger responses", async () => {
  const reference = encodeContentReference(contentReference(utf8("hosted text")));
  const original = { items: [{ envelope: toBase64url(reference), author: "A" }, { envelope: toBase64url(utf8("legacy")), author: "B" }], head: "500" };
  const unavailable = vi.fn().mockRejectedValue(Error("offline"));
  expect(await hydrateContent(original, unavailable, true)).toEqual(original);
  await expect(hydrateContent(original, unavailable)).rejects.toThrow("offline");
});
it("rejects poll wording that changes the ledger option count", async () => {
  const bytes = utf8(JSON.stringify({ question: "Changed", options: ["A", "B", "C"] }));
  await expect(hydrateContent({ question: contentReferenceUri(contentReference(bytes)), options: ["0", "1"] }, async () => bytes)).rejects.toThrow("poll wording");
});
it("isolates malformed references in directory/feed responses", async () => {
  const rows = [{ profileUri: "osp:content:v1:invalid" }, { profileUri: "", account: "valid" }];
  expect(await hydrateContent(rows, async () => new Uint8Array(), true)).toEqual(rows);
  await expect(hydrateContent(rows, async () => new Uint8Array())).rejects.toThrow("Invalid hosted");
});
