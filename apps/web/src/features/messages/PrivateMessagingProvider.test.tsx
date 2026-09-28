import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PrivateMessagingProvider } from "./PrivateMessagingProvider";
const mocks = vi.hoisted(() => {
  const me = { account: "test", seed: new Uint8Array(32) };
  return { me: me as typeof me | undefined, original: me, sync: vi.fn(async () => {}), stop: vi.fn(),
    services: { protocol: { chainId: "test", deployment: { contracts: { messaging: { address: "contract" } } } }, indexer: { watchPrivateUpdates: vi.fn((_changed: () => void) => vi.fn()) }, resolved: { sponsorUrls: [], payment: "sponsor-only" } },
    pending: true };
});
vi.mock("../session", () => ({ useMe: () => mocks.me }));
vi.mock("../../api/services", () => ({ useServices: () => mocks.services }));
vi.mock("../../vault/context", () => {
  const vault = { getState: () => ({ session: { identity: mocks.me } }) };
  return { useVaultStore: () => vault };
});
vi.mock("./privateStore", () => ({ PrivateStore: class {} }));
vi.mock("./privateService", () => ({ PrivateMessagingService: class {
  me: unknown;
  changed: (v: unknown) => void;
  constructor(me: unknown, _protocol: unknown, _indexer: unknown, _store: unknown, _urls: unknown, _payment: unknown, changed: (v: unknown) => void) {
    this.me = me;
    this.changed = changed;
  }
  load = async () => { this.changed({ enabled: true, registered: true, pending: mocks.pending ? 1 : 0, chats: [], error: "" });
  };
  sync = mocks.sync;
  stop = mocks.stop;
} }));
let root: Root | undefined, container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount()); container?.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); mocks.me = mocks.original;
});
it("continues pending setup while the unlocked browser is hidden and stops on lock", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<PrivateMessagingProvider>messages</PrivateMessagingProvider>));
  const initial = mocks.sync.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(mocks.sync.mock.calls.length - initial).toBe(3);
  await act(async () => { mocks.me = undefined; root!.render(<PrivateMessagingProvider>locked</PrivateMessagingProvider>); });
  const stopped = mocks.sync.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(mocks.sync).toHaveBeenCalledTimes(stopped);
  expect(mocks.stop).toHaveBeenCalled();
});
it("refreshes immediately on an indexer update and cleans up its watch on lock", async () => {
  const stopWatch = vi.fn();
  mocks.services.indexer.watchPrivateUpdates.mockReturnValueOnce(stopWatch);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<PrivateMessagingProvider>messages</PrivateMessagingProvider>));
  expect(mocks.services.indexer.watchPrivateUpdates).toHaveBeenCalledTimes(1);
  const before = mocks.sync.mock.calls.length;
  await act(async () => mocks.services.indexer.watchPrivateUpdates.mock.calls[0]![0]());
  expect(mocks.sync).toHaveBeenCalledTimes(before + 1);
  await act(async () => { mocks.me = undefined; root!.render(<PrivateMessagingProvider>locked</PrivateMessagingProvider>); });
  expect(stopWatch).toHaveBeenCalledTimes(1);
});
