/**
 * Side panel state: everything comes from the service worker through messages; the panel never
 * touches keys. Errors are kept per action so the UI can explain them.
 */
import { create } from "zustand";
import type { QueueItem } from "../background/app";
import type { FeedItem, FeedScope, VaultStatusView } from "../shared/protocol";
import { rpc } from "../shared/rpc";
import { errorMessage } from "../shared/format";

export type Tab = "feed" | "compose" | "queue";

interface FeedState {
  items: FeedItem[];
  nextCursor: string | null;
  loaded: boolean;
  notice?: string;
}

export interface ComposerPrefill {
  text: string;
  url?: string;
  title?: string;
  adapter: "sidepanel" | "generic";
}

export interface PanelState {
  status?: VaultStatusView;
  loading: boolean;
  busy: boolean;
  error?: string;
  tab: Tab;
  feedScope: FeedScope;
  feed: Record<FeedScope, FeedState>;
  queue: QueueItem[];
  prefill?: ComposerPrefill;
  skippedDeviceStep: boolean;
  refreshStatus(): Promise<void>;
  loadFeed(scope: FeedScope, options?: { more?: boolean; refresh?: boolean }): Promise<void>;
  loadQueue(): Promise<void>;
  setTab(tab: Tab): void;
  setFeedScope(scope: FeedScope): void;
  setPrefill(prefill: ComposerPrefill | undefined): void;
  skipDeviceStep(): void;
  run<T>(action: () => Promise<T>): Promise<T | undefined>;
  clearError(): void;
}

const emptyFeed = (): FeedState => ({ items: [], nextCursor: null, loaded: false });

export const usePanel = create<PanelState>()((set, get) => ({
  loading: true,
  busy: false,
  tab: "feed",
  feedScope: "public",
  feed: { public: emptyFeed(), friends: emptyFeed() },
  queue: [],
  skippedDeviceStep: false,

  async refreshStatus() {
    try {
      const status = await rpc<VaultStatusView>("vault.status");
      set({ status, loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },

  async loadFeed(scope, options = {}) {
    const current = get().feed[scope];
    const cursor = options.more ? (current.nextCursor ?? undefined) : undefined;
    if (options.more && !cursor) return;
    try {
      const page = await rpc<{ items: FeedItem[]; nextCursor: string | null; notice?: string }>("feed.get", { scope, cursor, refresh: options.refresh });
      set((state) => ({
        feed: {
          ...state.feed,
          [scope]: { items: options.more ? [...current.items, ...page.items] : page.items, nextCursor: page.nextCursor, loaded: true, notice: page.notice },
        },
      }));
    } catch (error) {
      set((state) => ({ feed: { ...state.feed, [scope]: { ...current, loaded: true, notice: errorMessage(error) } } }));
    }
  },

  async loadQueue() {
    try {
      const { items } = await rpc<{ items: QueueItem[] }>("crosspost.list");
      set({ queue: items });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  setTab(tab) {
    set({ tab });
  },
  setFeedScope(feedScope) {
    set({ feedScope });
  },
  setPrefill(prefill) {
    set({ prefill });
  },
  skipDeviceStep() {
    set({ skippedDeviceStep: true });
  },

  async run(action) {
    set({ busy: true, error: undefined });
    try {
      return await action();
    } catch (error) {
      set({ error: errorMessage(error) });
      return undefined;
    } finally {
      set({ busy: false });
    }
  },

  clearError() {
    set({ error: undefined });
  },
}));
