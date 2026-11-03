// @vitest-environment node
import { expect, it, vi } from "vitest";
import { memoryStorage } from "../../vault/storage";
import { createMusicCache } from "./musicCache";

it("bounds total storage and evicts the least recently played track", async () => {
  let now = 1;
  const storage = memoryStorage(), cache = createMusicCache(storage, 10, () => now++);
  await cache.put("one", new Uint8Array(4).fill(1));
  await cache.put("two", new Uint8Array(4).fill(2));
  expect((await cache.get("one"))?.length).toBe(4);
  await cache.put("three", new Uint8Array(4).fill(3));
  expect(await cache.get("two")).toBeUndefined();
  expect((await cache.get("one"))?.[0]).toBe(1);
  expect([...storage.map.values()].filter(v => v instanceof Uint8Array).reduce((n, v) => n + (v as Uint8Array).length, 0)).toBe(8);
  await cache.clear();
  expect(storage.map.size).toBe(0);
});
it("expires unused audio after thirty days and isolates caller mutations", async () => {
  let now = 100;
  const cache = createMusicCache(memoryStorage(), 100, () => now);
  const bytes = new Uint8Array([1, 2]);
  await cache.put("audio", bytes);
  bytes[0] = 9;
  const first = (await cache.get("audio"))!;
  first[0] = 8;
  expect((await cache.get("audio"))?.[0]).toBe(1);
  now += 31 * 24 * 60 * 60 * 1000;
  expect(await cache.get("audio")).toBeUndefined();
});
it("serializes concurrent downloads to keep the cache bounded", async () => {
  const storage = memoryStorage(), cache = createMusicCache(storage, 12);
  await Promise.all(Array.from({ length: 10 }, (_, n) => cache.put(String(n), new Uint8Array(4))));
  expect([...storage.map.values()].filter(v => v instanceof Uint8Array).reduce((n, v) => n + (v as Uint8Array).length, 0)).toBe(12);
});
it("treats inaccessible or full browser storage as an optional cache miss", async () => {
  const failed = vi.fn().mockRejectedValue(Error("quota exceeded"));
  const cache = createMusicCache({ get: failed, set: failed, del: failed });
  await expect(cache.get("a")).resolves.toBeUndefined();
  await expect(cache.put("a", new Uint8Array(4))).resolves.toBeUndefined();
  await expect(cache.remove("a")).resolves.toBeUndefined();
});
