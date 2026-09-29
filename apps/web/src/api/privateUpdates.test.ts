import { afterEach, expect, it, vi } from "vitest";
import { watchPrivateUpdates } from "./privateUpdates";

afterEach(() => { vi.useRealTimers(); });
const cursor = "a".repeat(64), next = "b".repeat(64);
it("wakes for changes, ignores unchanged cursors, and never sends a profile or conversation identifier", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ cursor }))
    .mockResolvedValueOnce(Response.json({ cursor }))
    .mockResolvedValueOnce(Response.json({ cursor: next }))
    .mockImplementation(() => new Promise(() => {}));
  const changed = vi.fn();
  const stop = watchPrivateUpdates("https://indexer.test", fetch, changed);
  await vi.advanceTimersByTimeAsync(0);
  expect(changed).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(500);
  expect(changed).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(500);
  expect(changed).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]![0]).toBe(`https://indexer.test/v2/private/updates?cursor=${cursor}`);
  expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  stop();
  const count = fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetch).toHaveBeenCalledTimes(count);
  expect(vi.getTimerCount()).toBe(0);
});
it("backs off on network interruption without generating an inbox error, then reconnects", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValueOnce(new Error("Fetch aborted"))
    .mockResolvedValueOnce(Response.json({ cursor })).mockResolvedValue(new Response("", { status: 404 }));
  const changed = vi.fn();
  const stop = watchPrivateUpdates("https://indexer.test", fetch, changed);
  await vi.advanceTimersByTimeAsync(999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(changed).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetch).toHaveBeenCalledTimes(3);
  stop();
});
it("cancels a suspended fetch on lock and suppresses its late result", async () => {
  vi.useFakeTimers();
  let resolve!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
  const changed = vi.fn();
  const stop = watchPrivateUpdates("https://indexer.test", fetch, changed);
  const signal = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal!;
  stop();
  expect(signal.aborted).toBe(true);
  resolve(Response.json({ cursor }));
  await vi.advanceTimersByTimeAsync(0);
  expect(changed).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
