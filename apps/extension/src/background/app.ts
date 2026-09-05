/**
 * Composition root of the service worker: services (vault, clients, key stores, feed,
 * cross-post orchestrator, adapters) and the message handlers exposed through the router.
 * Everything privileged lives here; pages and content scripts only send messages.
 */
import { AUDIENCE, type PostRef, type ProviderInterface, type ValueResult } from "@osp/sdk";
import { bytesOf, fromHex, toBase64url, toHex } from "../shared/bytes";
import { knownNetworks } from "../shared/config";
import type { FetchLike } from "../shared/indexer";
import {
  MAX_POST_CHARS,
  type AdapterStatusView,
  type DeviceStatusView,
  type FeedPage,
  type FeedRequestReply,
  type PageInfo,
  type ProposePayload,
  type SettingsView,
  type StoredCrossPost,
  type VaultStatusView,
} from "../shared/protocol";
import { explain, needsAttention, type QueueExplanation } from "../shared/queue";
import { SETTINGS_KEY, defaultSettings, resolveSettings, sanitizeSettings, type ResolveOptions, type Settings } from "../shared/settings";
import type { KeyValueArea } from "../shared/storage";
import { bool, empty, hex, httpUrl, num, obj, oneOf, optional, str, type Validator } from "../shared/validate";
import { adapterApi } from "./adapters";
import { updateBadge } from "./badge";
import { ClientRegistry, requireProtocol } from "./clients";
import { CrossPostOrchestrator } from "./crosspost";
import { FeedService } from "./feed";
import { EncryptedStore, KeyStore, deriveAesKey, type KeyCache } from "./keystore";
import { createRouter, defineHandler, type Handlers, type Router } from "./messages";
import { authorizeDevice, lookupDeviceStatus, publishPost, recordCrossPostProof } from "./publish";
import { VaultManager, type UnlockedSession, type VaultManagerOptions } from "./vault";

export interface BackgroundOptions extends ResolveOptions {
  local: KeyValueArea;
  session: KeyValueArea;
  runtimeId: string;
  /** chrome APIs (a mock in tests). */
  api?: typeof chrome;
  provider?: ProviderInterface;
  fetch?: FetchLike;
  kdf?: VaultManagerOptions["kdf"];
  now?: () => number;
  attemptId?: () => string;
}

export interface QueueItem {
  record: StoredCrossPost;
  explanation: QueueExplanation;
}

export interface Background {
  router: Router;
  vault: VaultManager;
  crossposts: CrossPostOrchestrator;
  feed: FeedService;
  loadSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  syncAdapters(): Promise<AdapterStatusView>;
  refreshBadge(): Promise<number>;
  autoLock(): Promise<boolean>;
  sweep(): Promise<void>;
}

const AUDIENCE_VALUES = [AUDIENCE.EVERYONE, AUDIENCE.FRIENDS] as const;

export function createBackground(options: BackgroundOptions): Background {
  const api = options.api ?? chrome;
  const now = options.now ?? (() => Date.now());
  const attemptId = options.attemptId ?? (() => toHex(crypto.getRandomValues(new Uint8Array(16))));
  const { local, session: sessionArea } = options;

  // ---------------------------------------------------------------- settings
  async function loadSettings(): Promise<Settings> {
    return sanitizeSettings(await local.get<unknown>(SETTINGS_KEY), defaultSettings(options.env));
  }
  async function saveSettings(settings: Settings): Promise<void> {
    await local.set(SETTINGS_KEY, settings);
    registry.invalidate();
    feed.invalidate();
  }

  // ---------------------------------------------------------------- services
  const vault = new VaultManager({ local, session: sessionArea, kdf: options.kdf, now });
  const registry = new ClientRegistry({ loadSettings, provider: options.provider, fetch: options.fetch, deployments: options.deployments, deploymentErrors: options.deploymentErrors, env: options.env });
  const adapters = adapterApi(api);
  const keyStores = new Map<string, KeyStore>();

  async function keysFor(session: UnlockedSession): Promise<KeyStore> {
    let store = keyStores.get(session.account);
    if (!store) {
      const key = await deriveAesKey(fromHex(session.encryptionSecret), "keystore");
      store = new KeyStore(new EncryptedStore<KeyCache>(local, `osp.keys.${session.account}`, key));
      await store.init();
      keyStores.set(session.account, store);
    }
    return store;
  }

  async function requireSession(): Promise<UnlockedSession> {
    const session = await vault.current();
    if (!session) throw new Error("Unlock your account first.");
    return session;
  }

  async function requireDevice(session: UnlockedSession): Promise<void> {
    const status = await vault.status();
    if (!status.deviceAuthorized) throw new Error("Authorize this browser first (side panel).");
    if (status.device && BigInt(status.device.expiresAt || "0") <= BigInt(now())) throw new Error("The device authorization expired; import the identity file to renew it.");
    void session;
  }

  const feed = new FeedService({ clients: () => registry.get(), session: () => vault.current(), keys: keysFor, vault, now });

  const crossposts = new CrossPostOrchestrator({
    storage: local,
    now,
    account: async () => (await vault.current())?.account,
    publishKoinos: async (record) => {
      const session = await requireSession();
      await requireDevice(session);
      const clients = await registry.get();
      const client = requireProtocol(clients);
      if (!record.text) throw new Error("The draft has no text.");
      const outcome = await publishPost(
        { text: record.text, audience: record.audience, attemptId: record.attemptId, ...(record.url && record.adapter !== "sidepanel" && { externalRef: record.url }) },
        { client, indexer: clients.indexer, session, vault, keys: await keysFor(session), payment: clients.resolved.payment, now },
      );
      feed.invalidate();
      return outcome;
    },
    lookupChain: async (author, key): Promise<ValueResult<PostRef> | undefined> => {
      const client = requireProtocol(await registry.get());
      return client.reads.publications.get_post_by_idempotency_key({ author, idempotency_key: key });
    },
    lookupIndexer: async (author, record) => {
      // The indexer API has no idempotency-key lookup; match the content hash of the envelope we built.
      if (!record.contentHash) return null;
      const clients = await registry.get();
      if (!clients.indexer.configured) return null;
      const wanted = toBase64url(fromHex(record.contentHash));
      try {
        const page = await clients.indexer.accountPosts(author, { limit: 50 });
        for (const post of page.items ?? []) {
          if (post.contentHash === wanted || (post.versions ?? []).some((v) => v.contentHash === wanted)) {
            return { postId: toHex(bytesOf(post.postId)), txId: post.txId, blockHeight: post.blockHeight };
          }
        }
      } catch {
        return null;
      }
      return null;
    },
    recordProof: async (record) => {
      const session = await requireSession();
      await requireDevice(session);
      const clients = await registry.get();
      const client = requireProtocol(clients);
      return recordCrossPostProof(record, { client, indexer: clients.indexer, session, vault, payment: clients.resolved.payment, now });
    },
    onChange: (records) => updateBadge(records, api, now()),
  });

  async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const current = await loadSettings();
    const next = sanitizeSettings({ ...current, ...patch }, defaultSettings(options.env));
    await saveSettings(next);
    await adapters.sync(next);
    return next;
  }

  async function syncAdapters(): Promise<AdapterStatusView> {
    return adapters.sync(await loadSettings());
  }

  async function refreshBadge(): Promise<number> {
    return updateBadge(await crossposts.list(), api, now());
  }

  async function autoLock(): Promise<boolean> {
    const settings = await loadSettings();
    const locked = await vault.checkAutoLock(settings.autoLockMinutes * 60_000, now());
    if (locked) keyStores.clear();
    return locked;
  }

  async function lock(): Promise<void> {
    await vault.lock();
    keyStores.clear();
    feed.invalidate();
  }

  async function vaultStatus(): Promise<VaultStatusView> {
    const [status, settings, records] = await Promise.all([vault.status(), loadSettings(), crossposts.list()]);
    const resolved = resolveSettings(settings, options);
    return {
      ...status,
      network: { name: resolved.network, deployed: resolved.deployed, ...(resolved.deploymentMessage && { message: resolved.deploymentMessage }), indexerUrl: resolved.indexerUrl },
      pending: records.filter((r) => needsAttention(r, now())).length,
      autoLockMinutes: settings.autoLockMinutes,
    };
  }

  async function settingsView(): Promise<SettingsView> {
    const settings = await loadSettings();
    const resolved = resolveSettings(settings, options);
    return {
      settings,
      resolved: {
        network: resolved.network,
        deployed: resolved.deployed,
        ...(resolved.deploymentMessage && { deploymentMessage: resolved.deploymentMessage }),
        ...(resolved.chainId && { chainId: resolved.chainId }),
        rpcUrls: resolved.rpcUrls,
        indexerUrl: resolved.indexerUrl,
        sponsorUrls: resolved.sponsorUrls,
      },
      networks: knownNetworks(options.deployments),
    };
  }

  function queueItem(record: StoredCrossPost): QueueItem {
    return { record, explanation: explain(record, now()) };
  }

  // ---------------------------------------------------------------- handlers
  const passphrase = str({ min: 1, max: 1024 });
  const attemptIdSchema = hex(16);
  const settingsPatch: Validator<Partial<Settings>> = obj({
    network: optional(str({ max: 32, pattern: /^[a-z0-9-]+$/i })),
    rpcUrls: optional((value, path) => (Array.isArray(value) ? value.map((v, i) => httpUrl()(v, `${path}[${i}]`)) : [])),
    indexerUrl: optional(str({ max: 2048 })),
    sponsorUrls: optional((value, path) => (Array.isArray(value) ? value.map((v, i) => httpUrl()(v, `${path}[${i}]`)) : [])),
    payment: optional(oneOf(["sponsor-then-self", "self-only", "sponsor-only"] as const)),
    autoLockMinutes: optional(num({ min: 0, max: 24 * 60 })),
    facebookAdapter: optional(bool()),
    feedInsertion: optional(bool()),
  });

  const handlers: Handlers = {
    "vault.status": defineHandler({ source: "extension", validate: empty, handle: () => vaultStatus() }),
    "vault.touch": defineHandler({ source: "extension", validate: empty, handle: async () => vault.touch() }),
    "vault.create": defineHandler({
      source: "extension",
      validate: obj({ passphrase }),
      handle: async (p) => ({ account: (await vault.create(p.passphrase)).account }),
    }),
    "vault.import": defineHandler({
      source: "extension",
      validate: obj({ identity: str({ max: 4096 }), passphrase }),
      handle: async (p) => ({ account: (await vault.import(p.identity, p.passphrase)).account }),
    }),
    "vault.unlock": defineHandler({
      source: "extension",
      validate: obj({ passphrase }),
      handle: async (p) => ({ account: (await vault.unlock(p.passphrase)).account }),
    }),
    "vault.lock": defineHandler({ source: "extension", validate: empty, handle: async () => lock() }),
    "vault.export": defineHandler({
      source: "extension",
      validate: obj({ passphrase }),
      handle: async (p) => ({ identity: await vault.export(p.passphrase) }),
    }),
    "vault.destroy": defineHandler({
      source: "extension",
      validate: obj({ passphrase }),
      handle: async (p) => {
        await vault.verifyPassphrase(p.passphrase);
        const record = await vault.record();
        await lock();
        await vault.destroy();
        if (record) await local.remove(`osp.keys.${record.account}`);
        keyStores.clear();
      },
    }),
    "device.authorize": defineHandler({
      source: "extension",
      validate: obj({ passphrase, keepOwnerSeed: bool() }),
      handle: async (p) => {
        const session = await requireSession();
        await vault.verifyPassphrase(p.passphrase);
        const clients = await registry.get();
        const client = requireProtocol(clients);
        const info = await authorizeDevice({ client, session, vault, payment: clients.resolved.payment, now });
        const { registered, ...device } = info;
        const next = await vault.completeDeviceAuthorization({ passphrase: p.passphrase, keepOwnerSeed: p.keepOwnerSeed, device });
        keyStores.clear();
        return { device, registered, mode: next.mode };
      },
    }),
    "device.status": defineHandler({
      source: "extension",
      validate: empty,
      handle: async (): Promise<DeviceStatusView> => {
        const status = await vault.status();
        if (!status.account) throw new Error("There is no account in this browser yet.");
        const clients = await registry.get();
        const client = requireProtocol(clients);
        const session = await vault.current();
        return lookupDeviceStatus(client, status.account, session?.deviceAddress ?? status.device?.address, now());
      },
    }),
    "settings.get": defineHandler({ source: "extension", validate: empty, handle: () => settingsView() }),
    "settings.update": defineHandler({
      source: "extension",
      validate: obj({ patch: settingsPatch }),
      handle: async (p) => {
        await updateSettings(p.patch);
        return settingsView();
      },
    }),
    "adapter.status": defineHandler({ source: "extension", validate: empty, handle: async () => adapters.status(await loadSettings()) }),
    "adapter.enable": defineHandler({
      source: "extension",
      validate: obj({ adapter: oneOf(["facebook"] as const) }),
      handle: async () => {
        if (!(await adapters.facebookGranted())) throw new Error("Grant the Facebook host permission first.");
        await updateSettings({ facebookAdapter: true });
        return adapters.status(await loadSettings());
      },
    }),
    "adapter.disable": defineHandler({
      source: "extension",
      validate: obj({ adapter: oneOf(["facebook"] as const) }),
      handle: async () => {
        await updateSettings({ facebookAdapter: false, feedInsertion: false });
        await adapters.disableFacebook();
        return adapters.status(await loadSettings());
      },
    }),
    "feed.get": defineHandler({
      source: "extension",
      validate: obj({ scope: oneOf(["public", "friends"] as const), cursor: optional(str({ max: 512 })), limit: optional(num({ min: 1, max: 50, int: true })), refresh: optional(bool()) }),
      handle: async (p): Promise<FeedPage> => feed.page(p.scope, p.cursor, { limit: p.limit, refresh: p.refresh }),
    }),
    "crosspost.list": defineHandler({
      source: "extension",
      validate: empty,
      handle: async () => ({ items: (await crossposts.list()).map(queueItem) }),
    }),
    "crosspost.create": defineHandler({
      source: "extension",
      validate: obj({
        text: str({ min: 1, max: MAX_POST_CHARS }),
        audience: oneOf(AUDIENCE_VALUES),
        adapter: oneOf(["sidepanel", "generic"] as const),
        url: optional(httpUrl()),
        title: optional(str({ max: 512 })),
      }),
      handle: async (p) => queueItem(await crossposts.create(p, attemptId())),
    }),
    "crosspost.confirm": defineHandler({
      source: "extension",
      validate: obj({ attemptId: attemptIdSchema, audience: optional(oneOf(AUDIENCE_VALUES)) }),
      handle: async (p) => queueItem(await crossposts.confirm(p.attemptId, { audience: p.audience })),
    }),
    "crosspost.retry": defineHandler({ source: "extension", validate: obj({ attemptId: attemptIdSchema }), handle: async (p) => queueItem(await crossposts.retry(p.attemptId)) }),
    "crosspost.reconcile": defineHandler({ source: "extension", validate: obj({ attemptId: attemptIdSchema }), handle: async (p) => queueItem(await crossposts.reconcile(p.attemptId)) }),
    "crosspost.markHost": defineHandler({
      source: "extension",
      validate: obj({ attemptId: attemptIdSchema, outcome: oneOf(["posted", "failed"] as const), detail: optional(str({ max: 2048 })) }),
      handle: async (p) => queueItem(await crossposts.markHost(p.attemptId, p.outcome, p.detail)),
    }),
    "crosspost.recordProof": defineHandler({ source: "extension", validate: obj({ attemptId: attemptIdSchema }), handle: async (p) => queueItem(await crossposts.recordProof(p.attemptId)) }),
    "crosspost.discard": defineHandler({ source: "extension", validate: obj({ attemptId: attemptIdSchema }), handle: async (p) => crossposts.discard(p.attemptId) }),
    "page.current": defineHandler({
      source: "extension",
      validate: empty,
      handle: async (): Promise<PageInfo> => {
        try {
          const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
          if (!tab) return { message: "No active tab." };
          if (!tab.url) return { ...(tab.title && { title: tab.title }), message: "The page address is not available. Click the extension icon on the page first (activeTab)." };
          if (!/^https?:/.test(tab.url)) return { message: "Only web pages can be shared." };
          return { url: tab.url, ...(tab.title && { title: tab.title }) };
        } catch (error) {
          return { message: error instanceof Error ? error.message : String(error) };
        }
      },
    }),

    // ------------------------------------------------------------ content scripts
    "crosspost.propose": defineHandler({
      source: "content",
      requireGesture: true,
      validate: obj({
        hostSite: oneOf(["facebook"] as const),
        text: str({ min: 1, max: MAX_POST_CHARS }),
        attemptId: attemptIdSchema,
        url: httpUrl(),
        submitted: bool(),
        userGesture: bool(),
      }),
      handle: async (p: ProposePayload, ctx) => {
        if (!ctx.origin || !p.url.toLowerCase().startsWith(ctx.origin)) throw new Error("The page URL does not match the sender origin.");
        const settings = await loadSettings();
        if (!settings.facebookAdapter) throw new Error("The Facebook adapter is disabled.");
        const record = await crossposts.propose(p);
        return { attemptId: record.attemptId, queued: true, state: record.state };
      },
    }),
    "feed.request": defineHandler({
      source: "content",
      validate: obj({ limit: optional(num({ min: 1, max: 5, int: true })) }),
      handle: async (p): Promise<FeedRequestReply> => {
        const settings = await loadSettings();
        if (!settings.feedInsertion || !settings.facebookAdapter) return { enabled: false, items: [] };
        try {
          return { enabled: true, items: await feed.publicPreview(p.limit ?? 5) };
        } catch {
          return { enabled: true, items: [] };
        }
      },
    }),
  };

  const router = createRouter({
    runtimeId: options.runtimeId,
    handlers,
    grantedOrigins: async () => {
      try {
        return (await api.permissions.getAll()).origins ?? [];
      } catch {
        return [];
      }
    },
    now,
  });

  // Extension-page traffic counts as activity for the auto-lock timer.
  const baseHandle = router.handle;
  const touchingRouter: Router = {
    handle: async (message, sender) => {
      const reply = await baseHandle(message, sender);
      const type = (message as { type?: string } | null)?.type;
      if (reply.ok && typeof type === "string" && type.startsWith("vault.") === false && sender.id === options.runtimeId) void vault.touch();
      return reply;
    },
    listener(message, sender, sendResponse) {
      touchingRouter
        .handle(message, sender)
        .catch((error: unknown) => ({ ok: false as const, error: { code: "internal", message: error instanceof Error ? error.message : String(error) } }))
        .then(sendResponse);
      return true;
    },
  };

  return {
    router: touchingRouter,
    vault,
    crossposts,
    feed,
    loadSettings,
    updateSettings,
    syncAdapters,
    refreshBadge,
    autoLock,
    sweep: () => crossposts.sweep(),
  };
}
