import { afterEach, expect, it, vi } from "vitest";
import { PrivateUpdates } from "./privateUpdates.js";
import type { IndexerDb } from "./db.js";

afterEach(() => { vi.useRealTimers(); });
it("wakes for new blocks and same-height forks without client-specific subscriptions", async () => {
  vi.useFakeTimers();
  let tip = { height: 1, block_id: "first" };
  const db = { lastCheckpoint: vi.fn(() => tip) } as unknown as IndexerDb;
  const updates = new PrivateUpdates(db);
  const signal = new AbortController().signal;
  const initial = await updates.wait(undefined, signal);
  expect(initial.cursor).toMatch(/^[a-f0-9]{64}$/);
  const next = updates.wait(initial.cursor, signal);
  tip = { height: 2, block_id: "second" };
  await vi.advanceTimersByTimeAsync(500);
  const second = await next;
  expect(second.cursor).not.toBe(initial.cursor);
  const fork = updates.wait(second.cursor, signal);
  tip = { height: 2, block_id: "replacement" };
  await vi.advanceTimersByTimeAsync(500);
  expect((await fork).cursor).not.toBe(second.cursor);
  updates.close();
  expect(vi.getTimerCount()).toBe(0);
});
it("bounds idle waits, disconnects cleanly, and drains pending requests on shutdown", async () => {
  vi.useFakeTimers();
  const updates = new PrivateUpdates({ lastCheckpoint: () => undefined } as unknown as IndexerDb);
  const abort = new AbortController();
  const initial = await updates.wait(undefined, abort.signal);
  const timeout = updates.wait(initial.cursor, abort.signal);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await timeout).toEqual(initial);
  const disconnected = updates.wait(initial.cursor, abort.signal);
  abort.abort();
  expect(await disconnected).toEqual(initial);
  const closing = updates.wait(initial.cursor, new AbortController().signal);
  updates.close();
  expect(await closing).toEqual(initial);
  expect(vi.getTimerCount()).toBe(0);
});
it("caps subscribers and uses one shared timer rather than a timer per browser", async () => {
  vi.useFakeTimers();
  const read = vi.fn(() => undefined);
  const updates = new PrivateUpdates({ lastCheckpoint: read } as unknown as IndexerDb);
  const signal = new AbortController().signal;
  const { cursor } = await updates.wait(undefined, signal);
  // Distinct signals avoid EventTarget listener-limit noise in this load check.
  const waiting = Array.from({ length: 256 }, () => updates.wait(cursor, new AbortController().signal));
  expect(await updates.wait(cursor, signal)).toEqual({ cursor, retryAfterMs: 8000 });
  read.mockClear();
  await vi.advanceTimersByTimeAsync(500);
  expect(read).toHaveBeenCalledTimes(1);
  updates.close();
  await Promise.all(waiting);
  expect(vi.getTimerCount()).toBe(0);
});
