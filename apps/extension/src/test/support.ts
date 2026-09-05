/**
 * Shared fakes for background tests: a fixture deployment, a fake koilib provider that answers
 * the reads the extension performs (identities with real encryption keys, device records,
 * relationships, audience epochs, posts by idempotency key) and records broadcasts (key package
 * sets, posts), a fake sponsor service reachable through `fetch`, a fake indexer serving what
 * those broadcasts produced, and a `createBackground` wired to in-memory storage.
 */
import { ABIS } from "@osp/proto";
import {
  ProtocolContracts,
  RELATIONSHIP_STATUS,
  Signer,
  addressToString,
  encode,
  parseKeyPackageSet,
  signSponsorDiscovery,
  toBase64url,
  toHex,
  type Deployment,
  type ProtoObject,
  type SponsorDiscovery,
  type UnsignedSponsorDiscovery,
} from "@osp/sdk";
import type { CallContractOperationJson, TransactionJson, TransactionReceipt } from "koilib";
import { coSign, deterministicRng, fakeProvider, fixtureDeployment, type FakeProvider } from "../../../../packages/sdk/src/testing/fixtures";
import { createBackground, type BackgroundOptions } from "../background/app";
import type { PostView, ProfileView, SealedKeyView } from "../shared/indexer";
import { memoryArea } from "../shared/storage";
import { createChromeMock, type ChromeMock } from "./chromeMock";

export const TEST_KDF = { N: 2 ** 10, r: 8, p: 1 };
export const RUNTIME_ID = "osp-test-extension";
export const SPONSOR_URL = "https://sponsor.test";
export const INDEXER_URL = "https://indexer.test";

export interface DecodedOp {
  contract: string;
  method: string;
  args: ProtoObject;
}

export interface ChainState {
  registered: Set<string>;
  /** Encryption keys published with `identity.register` (what `get_identity` serves). */
  identities: Map<string, { encryption_key: Uint8Array; key_version: number }>;
  devices: Map<string, { device: string; capabilities: number; expires_at: string; device_epoch: number; revoked: boolean }>;
  /** Relationship status per canonical pair key. */
  relationships: Map<string, number>;
  nextSequence: Record<string, string>;
  postsByKey: Map<string, Uint8Array>;
  audienceEpoch: Record<string, number>;
  /** Key package sets broadcast with `distribute_keys`. */
  keyPackages: Array<{ author: string; epoch: number; packages: Uint8Array; txId: string }>;
  /** Posts broadcast with `publish`, newest first (what an indexer would serve). */
  posts: PostView[];
  /** Every broadcast, decoded, in order. */
  broadcasts: Array<{ transaction: TransactionJson; ops: DecodedOp[] }>;
  /** Called for each broadcast; return a partial receipt (rpc_error to simulate a timeout) or throw. */
  onSend?: (tx: TransactionJson, decoded: DecodedOp[]) => Partial<TransactionReceipt> | undefined;
  /** Registers an identity with its encryption key (as the web client would). */
  registerIdentity(account: string, encryptionKey: Uint8Array, keyVersion?: number): void;
  /** Makes two accounts ACTIVE friends on chain. */
  befriend(a: string, b: string): void;
  friendsOf(account: string): string[];
}

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export function chainState(): ChainState {
  const state: ChainState = {
    registered: new Set(),
    identities: new Map(),
    devices: new Map(),
    relationships: new Map(),
    nextSequence: {},
    postsByKey: new Map(),
    audienceEpoch: {},
    keyPackages: [],
    posts: [],
    broadcasts: [],
    registerIdentity(account, encryptionKey, keyVersion = 1) {
      state.registered.add(account);
      state.identities.set(account, { encryption_key: encryptionKey, key_version: keyVersion });
    },
    befriend(a, b) {
      state.relationships.set(pairKey(a, b), RELATIONSHIP_STATUS.ACTIVE);
    },
    friendsOf(account) {
      const out: string[] = [];
      for (const [key, status] of state.relationships) {
        if (status !== RELATIONSHIP_STATUS.ACTIVE) continue;
        const [a, b] = key.split("|");
        if (a === account && b) out.push(b);
        else if (b === account && a) out.push(a);
      }
      return out;
    },
  };
  return state;
}

/** A fake provider whose read_contract answers come from `state` and whose broadcasts update it. */
export function fakeChain(deployment: Deployment, state: ChainState): FakeProvider {
  const contracts = new ProtocolContracts(deployment);
  const entry = (name: keyof typeof ABIS, method: string) => ABIS[name].methods[method]!.entry_point;
  let clock = 1_700_000_000_000;
  const onRead = (op: CallContractOperationJson): Uint8Array | undefined => {
    const decoded = contracts.decodeOperation(op);
    if (!decoded) return undefined;
    const args = decoded.args;
    switch (decoded.method) {
      case "get_identity": {
        const account = args.account as string;
        if (!state.registered.has(account)) return encode("identity.get_identity_result", {});
        const identity = state.identities.get(account);
        return encode("identity.get_identity_result", {
          value: { account, owner: account, encryption_key: identity?.encryption_key ?? new Uint8Array(32), key_version: identity?.key_version ?? 1, protocol_version: 1, device_epoch: 0, registered_at: "1", updated_at: "1" },
        });
      }
      case "get_device": {
        const device = state.devices.get(`${args.account}|${args.device}`);
        if (!device) return encode("identity.get_device_result", {});
        return encode("identity.get_device_result", { value: { account: args.account, ...device, label: "test", authorized_at: "1" } });
      }
      case "get_author_state":
        return encode("publications.get_author_state_result", { value: { next_sequence: state.nextSequence[args.author as string] ?? "1", last_publish_at: "0", post_count: "0" } });
      case "get_post_by_idempotency_key": {
        const post = state.postsByKey.get(`${args.author}|${toHex(args.idempotency_key as Uint8Array)}`);
        return post ? encode("publications.get_post_by_idempotency_key_result", { value: { post_id: post } }) : encode("publications.get_post_by_idempotency_key_result", {});
      }
      case "get_audience":
        return encode("relationships.get_audience_result", { value: { epoch: state.audienceEpoch[args.account as string] ?? 0, updated_at: "0" } });
      case "get_relationship": {
        const a = args.a as string;
        const b = args.b as string;
        const status = state.relationships.get(pairKey(a, b));
        if (status === undefined) return encode("relationships.get_relationship_result", {});
        return encode("relationships.get_relationship_result", { value: { a, b, status, requester: a, nonce: "1", updated_at: "1" } });
      }
      default:
        return undefined;
    }
  };
  const provider = fakeProvider({
    onRead,
    onSend: (tx, broadcast) => {
      const decoded = (tx.operations ?? []).map((op) => contracts.decodeOperation(op)).filter((d): d is NonNullable<typeof d> => d !== undefined);
      const extra = state.onSend?.(tx, decoded);
      if (extra?.rpc_error !== undefined || extra?.reverted) return extra;
      if (!broadcast) return extra;
      state.broadcasts.push({ transaction: tx, ops: decoded });
      const txId = tx.id ?? "";
      for (const d of decoded) {
        if (d.method === "register") state.registerIdentity(d.args.account as string, d.args.encryption_key as Uint8Array, d.args.key_version as number);
        if (d.method === "authorize_device") {
          state.devices.set(`${d.args.account}|${d.args.device}`, { device: d.args.device as string, capabilities: d.args.capabilities as number, expires_at: String(d.args.expires_at), device_epoch: 0, revoked: false });
        }
        if (d.method === "rotate_audience") {
          const actor = d.args.actor as string;
          state.audienceEpoch[actor] = (state.audienceEpoch[actor] ?? 0) + 1;
        }
        if (d.method === "distribute_keys") {
          state.keyPackages.push({ author: d.args.author as string, epoch: d.args.epoch as number, packages: d.args.packages as Uint8Array, txId });
        }
        if (d.method === "publish") {
          const author = d.args.author as string;
          state.postsByKey.set(`${author}|${toHex(d.args.idempotency_key as Uint8Array)}`, d.args.post_id as Uint8Array);
          state.nextSequence[author] = String(BigInt(d.args.sequence as string) + 1n);
          const createdAt = String((clock += 1000));
          const contentHash = toBase64url(d.args.content_hash as Uint8Array);
          state.posts.unshift({
            postId: toBase64url(d.args.post_id as Uint8Array),
            author,
            sequence: d.args.sequence as string,
            versionNumber: 1,
            contentHash,
            previousVersion: "",
            audience: d.args.audience as number,
            audienceId: toBase64url((d.args.audience_id as Uint8Array | undefined) ?? new Uint8Array(0)),
            epoch: (d.args.epoch as number) ?? 0,
            envelope: toBase64url(d.args.envelope as Uint8Array),
            media: [],
            replyTo: "",
            state: 0,
            stateReason: "",
            replacementId: "",
            createdAt,
            updatedAt: createdAt,
            txId,
            blockHeight: "101",
            reactions: { total: 0, byType: {} },
            replyCount: 0,
            versions: [{ contentHash, versionNumber: 1, txId, blockHeight: "101", timestamp: createdAt }],
            labels: [],
          });
        }
      }
      return extra;
    },
  });
  void entry;
  return provider;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export interface FakeSponsor {
  signer: Signer;
  address: string;
  /** Transactions received on POST /v1/sponsor. */
  received: TransactionJson[];
  /** When set, POST /v1/sponsor answers this refusal instead of sponsoring. */
  refuse?: { status: number; category: string; message?: string };
  handle(url: string, init?: RequestInit): Promise<Response>;
}

/** A fake sponsor service: signed discovery, co-signs and broadcasts (through the fake provider) on POST /v1/sponsor. */
export function fakeSponsor(deployment: Deployment, provider: FakeProvider): FakeSponsor {
  const signer = Signer.fromSeed("osp-extension-test-sponsor");
  const unsigned: UnsignedSponsorDiscovery = {
    version: 1,
    sponsor: signer.getAddress(),
    network: { chainId: deployment.chainId, rpc: deployment.rpc },
    policy: {
      version: 1,
      allowed: [
        { contract: deployment.contracts.publications.address, entryPoints: [] },
        { contract: deployment.contracts.relationships.address, entryPoints: [] },
        { contract: deployment.contracts.identity.address, entryPoints: [] },
      ],
      maxBytesPerOp: 6144,
      maxRcPerOp: "200000000",
      perUser: { dailyOps: 200, burstOps: 20, burstWindowSec: 60 },
    },
  };
  let discovery: Promise<SponsorDiscovery> | undefined;
  const sponsor: FakeSponsor = {
    signer,
    address: signer.getAddress(),
    received: [],
    async handle(url, init) {
      if (url === `${SPONSOR_URL}/.well-known/osp-sponsor.json`) {
        discovery ??= signSponsorDiscovery(unsigned, signer);
        return jsonResponse(200, await discovery);
      }
      if (url === `${SPONSOR_URL}/v1/sponsor` && init?.method === "POST") {
        const { transaction } = JSON.parse(String(init.body)) as { transaction: TransactionJson };
        sponsor.received.push(transaction);
        if (sponsor.refuse) return jsonResponse(sponsor.refuse.status, { error: { category: sponsor.refuse.category, message: sponsor.refuse.message ?? "refused" } });
        const coSigned = await coSign(transaction, signer);
        const { receipt } = await provider.sendTransaction(coSigned, true);
        return jsonResponse(200, { transaction: coSigned, receipt });
      }
      return jsonResponse(404, { error: { category: "invalid_transaction", message: "not found" } });
    },
  };
  return sponsor;
}

export interface FakeIndexer {
  /** Accounts the indexer *claims* are friends of everyone, on top of the chain's relationships (an untrusted indexer). */
  extraFriends: string[];
  /** Profile field overrides served by /v1/profiles/:account (e.g. a substituted encryption key). */
  profiles: Map<string, Partial<ProfileView>>;
  /** Overrides /v1/keys (return undefined to fall back to what the chain broadcasts produced). */
  keysOverride?: (account: string, query: URLSearchParams) => SealedKeyView[] | undefined;
  /** When true every request fails at the transport level. */
  unreachable: boolean;
  requests: string[];
  keysFor(account: string, filter: { author?: string; epoch?: number }): SealedKeyView[];
  handle(url: string, init?: RequestInit): Promise<Response>;
}

/** A fake INDEXER API v1 serving what the fake chain recorded. */
export function fakeIndexer(state: ChainState): FakeIndexer {
  const indexer: FakeIndexer = {
    extraFriends: [],
    profiles: new Map(),
    unreachable: false,
    requests: [],
    keysFor(account, filter) {
      const out: SealedKeyView[] = [];
      for (const entry of state.keyPackages) {
        if (filter.author !== undefined && entry.author !== filter.author) continue;
        if (filter.epoch !== undefined && entry.epoch !== filter.epoch) continue;
        const set = parseKeyPackageSet(entry.packages);
        for (const sealed of set.keys) {
          const recipient = addressToString(sealed.recipient);
          if (recipient !== account) continue;
          out.push({ author: entry.author, audienceId: toBase64url(set.audience_id), epoch: entry.epoch, recipient, sealedKey: toBase64url(encode("osp.envelope.sealed_key", sealed as unknown as ProtoObject)), blockHeight: "101", txId: entry.txId });
        }
      }
      return out;
    },
    async handle(url) {
      indexer.requests.push(url);
      if (indexer.unreachable) throw new TypeError("fetch failed");
      const parsed = new URL(url);
      const path = parsed.pathname;
      const q = parsed.searchParams;
      const friendsOf = (account: string) => [...new Set([...state.friendsOf(account), ...indexer.extraFriends.filter((f) => f !== account)])];
      let match: RegExpExecArray | null;
      if ((match = /^\/v1\/graph\/([^/]+)$/.exec(path))) {
        const account = decodeURIComponent(match[1]!);
        return jsonResponse(200, {
          account,
          friends: friendsOf(account).map((f) => ({ account: f, since: "1", nonce: "1" })),
          pendingIncoming: [],
          pendingOutgoing: [],
          followers: [],
          following: [],
          blocked: [],
          audienceEpoch: state.audienceEpoch[account] ?? 0,
        });
      }
      if ((match = /^\/v1\/profiles\/([^/]+)$/.exec(path))) {
        const account = decodeURIComponent(match[1]!);
        const override = indexer.profiles.get(account);
        const identity = state.identities.get(account);
        if (!override && !identity) return jsonResponse(404, { error: { code: "not_found", message: "unknown profile" } });
        const profile: ProfileView = {
          account,
          owner: account,
          encryptionKey: toBase64url(identity?.encryption_key ?? new Uint8Array(32)),
          keyVersion: identity?.key_version ?? 1,
          profileHash: "",
          profileUri: "",
          protocolVersion: 1,
          deviceEpoch: 0,
          registeredAt: "1",
          updatedAt: "1",
          counts: { posts: 0, friends: friendsOf(account).length, followers: 0, following: 0 },
          ...override,
        };
        return jsonResponse(200, profile);
      }
      if ((match = /^\/v1\/keys\/([^/]+)$/.exec(path))) {
        const account = decodeURIComponent(match[1]!);
        const items = indexer.keysOverride?.(account, q) ?? indexer.keysFor(account, { author: q.get("author") ?? undefined, epoch: q.has("epoch") ? Number(q.get("epoch")) : undefined });
        return jsonResponse(200, { items });
      }
      if (path === "/v1/feed") {
        const viewer = q.get("viewer") ?? "";
        const scope = q.get("scope") ?? "public";
        const friends = viewer ? new Set([viewer, ...state.friendsOf(viewer)]) : new Set<string>();
        const items = state.posts.filter((post) => {
          const isPublic = post.audience === 0;
          const isFriends = friends.has(post.author);
          return scope === "public" ? isPublic : scope === "friends" ? isFriends : isPublic || isFriends;
        });
        return jsonResponse(200, { items, nextCursor: null });
      }
      if ((match = /^\/v1\/accounts\/([^/]+)\/posts$/.exec(path))) {
        const account = decodeURIComponent(match[1]!);
        return jsonResponse(200, { items: state.posts.filter((post) => post.author === account), nextCursor: null });
      }
      if ((match = /^\/v1\/posts\/([^/]+)$/.exec(path))) {
        const id = decodeURIComponent(match[1]!);
        const post = state.posts.find((p) => p.postId === id);
        return post ? jsonResponse(200, post) : jsonResponse(404, { error: { code: "not_found", message: "unknown post" } });
      }
      return jsonResponse(404, { error: { code: "not_found", message: `no route for ${path}` } });
    },
  };
  return indexer;
}

export interface TestBackground {
  chrome: ChromeMock;
  provider: FakeProvider;
  state: ChainState;
  deployment: Deployment;
  sponsor: FakeSponsor;
  indexer: FakeIndexer;
  background: ReturnType<typeof createBackground>;
  local: ReturnType<typeof memoryArea>;
  session: ReturnType<typeof memoryArea>;
  /** Sends a message as an extension page and unwraps the reply (throws on error replies). */
  call<T = unknown>(type: string, payload?: unknown): Promise<T>;
  now: { value: number };
}

export interface TestBackgroundOptions extends Partial<BackgroundOptions> {
  origins?: string[];
  deployed?: boolean;
  /** Configure the fake sponsor (default true: a device-only vault publishes through a sponsor). */
  sponsor?: boolean;
  /** Configure the fake indexer (default false: friends-only posts and feeds need it). */
  indexer?: boolean;
}

export function createTestBackground(options: TestBackgroundOptions = {}): TestBackground {
  const chromeMock = createChromeMock({ id: RUNTIME_ID, origins: options.origins ?? [] });
  const deployment = fixtureDeployment();
  const state = chainState();
  const provider = fakeChain(deployment, state);
  const sponsor = fakeSponsor(deployment, provider);
  const indexer = fakeIndexer(state);
  const local = memoryArea();
  const session = memoryArea();
  const now = { value: 1_800_000_000_000 };
  const attemptRng = deterministicRng("attempts");
  const withSponsor = options.sponsor ?? true;
  const withIndexer = options.indexer ?? false;
  const fetch: BackgroundOptions["fetch"] =
    options.fetch ??
    (async (url, init) => {
      if (url.startsWith(SPONSOR_URL)) return sponsor.handle(url, init);
      if (url.startsWith(INDEXER_URL)) return indexer.handle(url, init);
      return jsonResponse(404, { error: { code: "not_found", message: "no such service in tests" } });
    });
  const { origins: _origins, deployed: _deployed, sponsor: _sponsor, indexer: _indexer, ...rest } = options;
  const background = createBackground({
    local,
    session,
    runtimeId: RUNTIME_ID,
    api: chromeMock as unknown as typeof chrome,
    provider,
    kdf: TEST_KDF,
    now: () => now.value,
    deployments: options.deployed === false ? {} : { fixture: deployment },
    deploymentErrors: {},
    env: { network: "fixture", rpcUrls: [], indexerUrl: withIndexer ? INDEXER_URL : "", sponsorUrls: withSponsor ? [SPONSOR_URL] : [] },
    attemptId: () => toHex(attemptRng(16)),
    ...rest,
    fetch,
  });
  chromeMock.runtime.onMessage.addListener(background.router.listener);
  return {
    chrome: chromeMock,
    provider,
    state,
    deployment,
    sponsor,
    indexer,
    background,
    local,
    session,
    now,
    async call<T>(type: string, payload?: unknown): Promise<T> {
      const reply = (await chromeMock._dispatch({ type, payload }, chromeMock._extensionSender())) as { ok: boolean; result?: T; error?: { code: string; message: string } };
      if (!reply.ok) throw new Error(`${reply.error?.code}: ${reply.error?.message}`);
      return reply.result as T;
    },
  };
}
