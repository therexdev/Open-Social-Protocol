import { webcrypto } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  contentHash,
  fromBase64url,
  identityFromSeed,
  toBase64url,
  type Identity,
  type PrivateDevice,
  type ProtocolClient,
  ProtocolContracts,
  decode,
  encode,
  type ContractName,
  SponsorClient,
  randomBytes,
  sealPrivateInvitation,
  signPrivateStatement,
  verifyPrivateStatement,
  encryptPrivateMessage,
} from "@osp/sdk";
import { ABIS } from "@osp/proto";
import { fixtureDeployment } from "../../../../../packages/sdk/src/testing/fixtures";
import type { IndexerClient, PrivatePacketView } from "../../api/indexer";
import { memoryStorage } from "../../vault/storage";
import { PrivateStore, type ExclusiveLock } from "./privateStore";
import {
  PrivateMessagingService,
  type PrivateSnapshot,
} from "./privateService";

vi.mock("../../tx/submit", () => ({
  submitAction: async (ctx: any, ops: any[], options: any) =>
    ctx.client.submit({ operations: ops, signer: ctx.signer, waitForReceipt: options.waitForReceipt }),
}));
beforeAll(() =>
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  }),
);
afterEach(() => vi.restoreAllMocks());
const alice = identityFromSeed(new Uint8Array(32).fill(81), 1),
  bob = identityFromSeed(new Uint8Array(32).fill(82), 1);
const deployment = { ...fixtureDeployment(), chainId: "test" };
const scope = { chainId: "test", contract: deployment.contracts.messaging.address };
const locks = new Map<string, Promise<unknown>>();
const lock: ExclusiveLock = async (name, action) => {
  const p = (locks.get(name) ?? Promise.resolve()).catch(() => {}).then(action);
  locks.set(name, p);
  return p;
};
function harness(prepaid = true, fast = false, auto = false, warm = false) {
  let delayedNonce = false;
  const pendingNonces = new Set<string>();
  const devices = new Map<string, PrivateDevice[]>(),
    channels = new Map<string, any>(),
    packets: PrivatePacketView[] = [],
    operations: any[] = [],
    transactions: any[][] = [],
    units = new Map<string, number>(),
    reservations = new Map<string, any>(), grants = new Map<string, any>();
  const pair = (a: string, b: string) => [a, b].sort().join(":");
  let unknown = false,
    lib = "1000", height = "1000",
    directoryDown = false;
  const reads = {
    get_private_status: async () => ({
      version: 2,
      sequence: String(packets.length),
    }),
    get_private_devices: async ({ account }: any) => {
      if (directoryDown) throw new Error("Directory RPC unavailable");
      return { values: devices.get(account) ?? [] };
    },
    get_private_units: async ({ account }: any) => ({ units: String(units.get(account) ?? (prepaid ? 100 : 0)) }),
    get_private_reservation: async ({ reservation_id }: any) => ({ value: reservations.get(toBase64url(reservation_id)) }),
    get_private_grant: async ({ grant_id }: any) => ({ value: grants.get(toBase64url(grant_id)) }),
    get_private_packet: async ({ actor, packet_id }: any) => {
      const p = packets.find(
        (p) => p.actor === actor && p.packet_id === toBase64url(packet_id),
      );
      return {
        value: p
          ? {
              ...p,
              packet_id: fromBase64url(p.packet_id),
              content_hash: fromBase64url(p.content_hash),
            }
          : undefined,
      };
    },
    get_private_channel: async ({ a, b }: any) => ({
      value: structuredClone(channels.get(pair(a, b))),
    }),
  };
  const protocol = {
    chainId: scope.chainId,
    deployment: { ...deployment, network: fast ? "harbinger" : deployment.network },
    provider: { getHeadInfo: async () => ({ last_irreversible_block: lib, head_topology: { height } }) },
    reads: {
      messaging: reads,
      identity: {
        get_identity: async ({ account }: any) => ({
          value: { owner: account },
        }),
      },
      relationships: { is_blocked: async () => ({ value: false }) },
    },
    ops: {
      messaging: new Proxy(
        {},
        { get: (_, method) => async (args: any) => ({ method, args }) },
      ),
    },
    submit: async ({ operations: ops, signer, waitForReceipt }: any) => {
      const account = signer.getAddress();
      const reserves = delayedNonce && ops.some((op: any) => op.method === "reserve_private_usage");
      if (reserves && pendingNonces.has(account)) throw new Error("invalid account nonce");
      if (reserves) pendingNonces.add(account);
      const debit = (actor: string) => {
        const remaining = units.get(actor) ?? (prepaid ? 100 : 0);
        if (remaining < 1) throw new Error("Insufficient private units");
        units.set(actor, remaining - 1);
      };
      transactions.push(structuredClone(ops));
      for (const op of ops) {
        const a = op.args;
        operations.push({ ...op, signer: signer.getAddress() });
        if (op.method === "reserve_private_usage") {
          const key = toBase64url(a.reservation_id);
          if (!reservations.has(key)) reservations.set(key, { ...a, block: "5" });
        }
        if (op.method === "set_private_device") {
          const existing = (devices.get(a.account) ?? []).filter(d => toBase64url(d.device_id) !== toBase64url(a.device_id));
          devices.set(a.account, [ ...existing, ...(a.delivery_key?.length ? [{
              device_id: a.device_id,
              delivery_key: a.delivery_key,
              label: a.label,
              updated_at: String(Date.now()),
            }] : []),
          ]);
        }
        if (op.method === "open_private_channel") {
          const key = pair(a.actor, a.peer),
            old = channels.get(key);
          if (!old || (old.status === 1 && old.requester !== a.actor)) debit(a.actor);
          channels.set(
            key,
            old
              ? { ...old, status: old.status === 2 || old.requester !== a.actor ? 2 : 1 }
              : { a: a.actor, b: a.peer, requester: a.actor, status: 1 },
          );
        }
        if (op.method === "close_private_channel") {
          const key = pair(a.actor, a.peer);
          channels.set(key, { ...channels.get(key), status: 3, block: "5" });
        }
        if (op.method === "post_private_packet") {
          if (a.peer && channels.get(pair(a.actor, a.peer))?.status !== 2) throw new Error("Channel must be mutually open before posting");
          if (
            !packets.some(
              (p) =>
                p.actor === a.actor && p.packet_id === toBase64url(a.packet_id),
            )
          ) {
            debit(a.actor);
            packets.push({
              actor: a.actor,
              peer: a.peer ?? "",
              packet_id: toBase64url(a.packet_id),
              content_hash: toBase64url(contentHash(a.envelope)),
              sequence: String(packets.length + 1),
              timestamp: String(Date.now()),
              block: "5",
              envelope: toBase64url(a.envelope),
              txId: "test",
            });
          }
          if (unknown) {
            unknown = false;
            throw new Error("Network timeout after broadcast");
          }
        }
      }
      if (reserves && waitForReceipt) {
        // Inclusion advances the chain nonce; merely broadcasting does not.
        await Promise.resolve();
        pendingNonces.delete(account);
      }
      return {};
    },
  } as unknown as ProtocolClient;
  // Exercise the actual SDK wire reader, including the live RPC's {} reply for
  // zero-byte Protobuf results. Object-only mocks hid first-browser failures.
  const rawReads = protocol.reads;
  protocol.provider.readContract = async call => {
    const name = (Object.keys(deployment.contracts) as ContractName[])
      .find(name => deployment.contracts[name].address === call.contract_id)!;
    const [method, definition] = Object.entries(ABIS[name].methods)
      .find(([, definition]) => definition.entry_point === call.entry_point)!;
    const args = decode(definition.argument, call.args ?? "");
    const result = await (rawReads[name] as any)[method](args);
    const bytes = encode(definition.return, result);
    return (bytes.length ? { result: toBase64url(bytes) } : {}) as any;
  };
  Object.assign(protocol, { reads: new ProtocolContracts(deployment, protocol.provider).reads });
  const indexer = {
    privatePackets: async (after: string, actor?: string, peer?: string) => ({
      items: packets.filter(
        (p) =>
          BigInt(p.sequence) > BigInt(after) &&
          (actor
            ? (p.actor === actor && p.peer === peer) ||
              (p.actor === peer && p.peer === actor)
            : !p.peer),
      ),
      more: false,
    }),
  } as unknown as IndexerClient;
  function device(me: Identity) {
    const storage = memoryStorage();
    let active = true;
    let snapshot: PrivateSnapshot = {
      enabled: false,
      registered: false,
      chats: [],
      pending: 0,
      error: "",
    };
    const store = new PrivateStore(
      me.account,
      me.seed,
      scope,
      () => active,
      storage,
      lock,
    );
    const initialized = store.edit(async data => { data.autoConnect = auto; data.prepareInAdvance = warm; });
    const make = () =>
      new PrivateMessagingService(
        me,
        protocol,
        indexer,
        store,
        prepaid ? [] : ["https://sponsor.test"],
        "sponsor-only",
        (s) => {
          snapshot = s;
        },
      );
    let service = make();
    return {
      store,
      initialized,
      storage,
      anotherTab: make,
      get service() {
        return service;
      },
      get snapshot() {
        return snapshot;
      },
      lock() {
        active = false;
        service.stop();
      },
      reload() {
        service.stop();
        service = make();
      },
    };
  }
  const a = device(alice),
    b = device(bob);
  async function pump(n = 5) {
    for (let i = 0; i < n; i++) {
      await a.service.load();
      await a.service.sync();
      await b.service.load();
      await b.service.sync();
    }
  }
  async function connect() {
    await a.service.enable();
    await b.service.enable();
    await pump();
    const chat = await a.service.start(bob.account);
    await pump();
    expect(b.snapshot.error).toBe("");
    expect(b.snapshot.chats[0]?.status).toBe("incoming");
    await b.service.accept(chat);
    await pump(8);
    expect(a.snapshot.error).toBe("");
    expect(b.snapshot.error).toBe("");
    expect(a.snapshot.chats[0]?.status).toBe("ready");
    expect(b.snapshot.chats[0]?.status).toBe("ready");
    return chat;
  }
  return {
    a,
    b,
    device,
    packets,
    operations,
    transactions,
    pump,
    connect,
    reservations,
    delayNonceUntilInclusion: () => { delayedNonce = true; },
    allocate: (reservationId: string, actor: string, signature: string) => {
      const reservation = reservations.get(reservationId);
      expect(reservation).toBeDefined();
      expect(verifyPrivateStatement(scope, "allocate", { reservationId, actor }, signature, reservation.account)).toBe(true);
      units.set(actor, (units.get(actor) ?? 0) + reservation.units);
      grants.set(reservationId, { grant_id: fromBase64url(reservationId), sponsor: reservation.sponsor, actor, units: reservation.units });
    },
    setDirectoryDown: (value: boolean) => { directoryDown = value; },
    protocol, indexer, devices, channels, grants, units,
    setHead: (value: string) => { height = value; },
    setUnknown: () => {
      unknown = true;
    },
    setLib: (n: string) => {
      lib = n;
    },
  };
}

describe("two-browser private conversations", () => {
  it("rejects conflicting logical message IDs before committing keys or poisoning saved history", async () => {
    const h = harness(); const chatId = await h.connect();
    await h.a.service.send(chatId, "Authentic original"); await h.pump();
    const before = await h.b.store.edit(async data => structuredClone(data.chats[0]!.ratchet));
    // An authenticated peer can deliberately encrypt a second, conflicting
    // plaintext under the original logical ID. Chain validity is not enough.
    const forged = await h.a.store.edit(async data => {
      const chat = data.chats[0]!, packetId = toBase64url(randomBytes(32));
      const encrypted = await encryptPrivateMessage(fromBase64url(data.pickleKey), chat.ratchet!,
        { ...scope, actor: chat.alias, peer: chat.peerAlias!, packetId }, "Conflicting replacement",
        { id: chat.messages[0]!.logicalId!, deviceId: data.deviceId, threadId: chatId, sentAt: Date.now() });
      return { actor: chat.alias, peer: chat.peerAlias!, packet_id: packetId,
        envelope: toBase64url(encrypted.envelope), content_hash: toBase64url(contentHash(encrypted.envelope)),
        block: "5", sequence: String(h.packets.length + 1), timestamp: String(Date.now()), txId: "malicious-peer" };
    });
    h.packets.push(forged); await h.b.service.sync();
    expect(h.b.snapshot.error).toContain("conflicting");
    expect(h.b.snapshot.chats[0]?.messages.map(m => m.text)).toEqual(["Authentic original"]);
    await h.b.store.edit(async data => expect(data.chats[0]!.ratchet).toEqual(before));
    h.b.reload(); await h.b.service.load();
    expect(h.b.snapshot.chats[0]?.messages.map(m => m.text)).toEqual(["Authentic original"]);
  });
  it("reuses provisional verification without skipping changed packets or final chain checks", async () => {
    const h = harness(true, true);
    h.setLib("1"); h.setHead("5");
    const chat = await h.connect();
    await h.a.service.send(chat, "Arrived automatically"); await h.pump();
    const packet = h.packets.find(p => p.peer)!;
    const original = h.protocol.reads.messaging.get_private_packet;
    const read = vi.spyOn(h.protocol.reads.messaging, "get_private_packet");
    await h.b.service.sync(); await h.b.service.sync();
    const checks = () => read.mock.calls.filter(([args]) => toBase64url(args!.packet_id) === packet.packet_id);
    expect(checks()).toHaveLength(0);
    expect(h.b.snapshot.chats[0]!.messages).toHaveLength(1);
    // A changed indexer row cannot borrow the cached verification of an older row.
    const list = h.indexer.privatePackets.bind(h.indexer);
    const index = vi.spyOn(h.indexer, "privatePackets").mockImplementation(async (...args) => {
      const page = await list(...args);
      return { ...page, items: page.items.map(p => p.packet_id === packet.packet_id ? { ...p, envelope: toBase64url(new Uint8Array([9])) } : p) };
    });
    await h.b.service.sync();
    expect(checks()).toHaveLength(1);
    expect(h.b.snapshot.error).toContain("could not be verified");
    index.mockRestore(); read.mockClear();
    // At irreversibility the RPC must still prove the record, even if cached.
    h.setLib("5");
    read.mockImplementation(async args => toBase64url(args!.packet_id) === packet.packet_id ? { value: undefined } : original(args));
    await h.b.service.sync();
    expect(checks()).toHaveLength(1);
    await h.b.store.edit(async data => expect(data.chats[0]!.after).not.toBe(packet.sequence));
    read.mockImplementation(original);
    await h.b.service.sync();
    await h.b.store.edit(async data => expect(data.chats[0]!.after).toBe(packet.sequence));
    expect(h.b.snapshot.chats[0]!.messages).toHaveLength(1);
    expect(h.b.snapshot.chats[0]!.messages[0]!.state).toBe("sent");
  });
  it("coalesces an update during sync and displays received text before unrelated background work completes", async () => {
    const h = harness();
    const chat = await h.connect();
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const list = h.indexer.privatePackets.bind(h.indexer);
    let channelReads = 0;
    vi.spyOn(h.indexer, "privatePackets").mockImplementation(async (...args) => {
      const page = await list(...args);
      if (args[1] && channelReads++ === 0) { entered(); await held; }
      return page;
    });
    const first = h.b.service.sync(); await started;
    await h.a.service.send(chat, "Wake during a refresh"); await h.a.service.sync();
    const again = h.b.service.sync();
    release(); await first; await again;
    expect(h.b.snapshot.chats[0]!.messages.at(-1)?.text).toBe("Wake during a refresh");
    expect(channelReads).toBeGreaterThanOrEqual(2);
    let releaseBackground!: () => void, backgroundEntered!: () => void;
    const background = new Promise<void>(resolve => { releaseBackground = resolve; });
    const reached = new Promise<void>(resolve => { backgroundEntered = resolve; });
    vi.spyOn(h.b.service as any, "warmAllowance").mockImplementationOnce(async () => { backgroundEntered(); await background; });
    await h.a.service.send(chat, "Show before preparing credits"); await h.a.service.sync();
    const refreshing = h.b.service.sync(); await reached;
    try { expect(h.b.snapshot.chats[0]!.messages.at(-1)?.text).toBe("Show before preparing credits"); }
    finally { releaseBackground(); await refreshing; }
  });
  it("saves and delivers the first message with no request or acceptance clicks, using two allowances and batched consent", async () => {
    const h = harness(false, true, true);
    h.setLib("1"); h.setHead("7");
    vi.spyOn(SponsorClient.prototype, "discover").mockResolvedValue({
      sponsor: deployment.contracts.sponsorship.address,
      policy: { privateUsageConfirmations: 3, allowed: [{ contract: scope.contract, entryPoints: [ABIS.messaging.methods.reserve_private_usage!.entry_point] }] },
    } as any);
    vi.spyOn(SponsorClient.prototype, "allocatePrivateUsage").mockImplementation(async payload => {
      h.allocate(payload.reservationId, payload.actor, payload.signature);
      return { grantId: payload.reservationId, pending: true };
    });
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    await h.a.service.queueMessage(bob.account, "A first message without approval");
    expect(h.a.snapshot.chats[0]?.messages[0]?.text).toBe("A first message without approval");
    await h.pump(12);
    expect(h.a.snapshot.error).toBe(""); expect(h.b.snapshot.error).toBe("");
    expect(h.b.snapshot.chats[0]?.messages[0]?.text).toBe("A first message without approval");
    expect(h.b.snapshot.chats[0]?.messages[0]?.mine).toBe(false);
    expect(h.reservations.size).toBe(2);
    expect([...h.units.values()].reduce((sum, value) => sum + value, 0)).toBe(3);
    expect([...h.reservations.values()].map(r => r.units)).toEqual([4, 4]);
    expect(h.transactions.filter(ops => ops.length === 2 && ops[0].method === "open_private_channel" && ops[1].method === "post_private_packet")).toHaveLength(2);
    await h.a.store.drafts(drafts => expect(drafts).toHaveLength(0));
    await h.b.service.queueMessage(alice.account, "Automatic reply"); await h.pump();
    expect(h.a.snapshot.chats[0]?.messages.at(-1)?.text).toBe("Automatic reply");
  });
  it("prepares one allowance in advance and uses only three transactions for the first message", async () => {
    const h = harness(false, true, true, true);
    vi.spyOn(SponsorClient.prototype, "discover").mockResolvedValue({
      sponsor: deployment.contracts.sponsorship.address,
      policy: { privateUsageConfirmations: 3, allowed: [{ contract: scope.contract, entryPoints: [ABIS.messaging.methods.reserve_private_usage!.entry_point] }] },
    } as any);
    vi.spyOn(SponsorClient.prototype, "allocatePrivateUsage").mockImplementation(async payload => {
      h.allocate(payload.reservationId, payload.actor, payload.signature);
      return { grantId: payload.reservationId, pending: true };
    });
    await h.a.service.enable(); await h.b.service.enable(); await h.pump(8);
    expect(h.reservations.size).toBe(2);
    await h.a.store.edit(async data => expect(data.spareAliasReady).toBe(true));
    await h.b.store.edit(async data => expect(data.spareAliasReady).toBe(true));
    h.a.reload(); h.b.reload(); await h.pump();
    expect(h.reservations.size).toBe(2);
    // Disabling further preparation preserves already prepaid credits for use.
    await h.a.service.setPrepareInAdvance(false); await h.b.service.setPrepareInAdvance(false);
    await h.pump(); const count = h.transactions.length;
    await h.a.service.queueMessage(bob.account, "Prepared earlier"); await h.pump(8);
    expect(h.b.snapshot.chats[0]?.messages[0]?.text).toBe("Prepared earlier");
    expect(h.transactions.length - count).toBe(3);
    await h.a.service.setPrepareInAdvance(true); await h.b.service.setPrepareInAdvance(true);
    await h.b.service.queueMessage(alice.account, "Reply before optional replenishment"); await h.pump();
    expect(h.transactions.length - count).toBe(4);
    expect(h.a.snapshot.chats[0]?.messages.at(-1)?.text).toBe("Reply before optional replenishment");
    expect(h.reservations.size).toBe(2);
    await h.a.store.edit(async data => expect(data.spareAliasId).toBeUndefined());
  });
  it("keeps a prepaid wallet available when signing the introduction fails", async () => {
    const h = harness(true, true, true);
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const spare = toBase64url(randomBytes(32));
    await h.a.store.edit(async data => { data.spareAliasId = spare; data.spareAliasReady = true; });
    const signing = vi.spyOn(alice.signer, "signHash").mockRejectedValue(new Error("Signing unavailable"));
    await h.a.service.queueMessage(bob.account, "Saved while signing fails");
    await h.a.service.load();
    await h.a.store.edit(async data => { expect(data.spareAliasId).toBe(spare); expect(data.chats).toHaveLength(0); });
    signing.mockRestore(); await h.pump(10);
    expect(h.b.snapshot.chats[0]?.messages[0]?.text).toBe("Saved while signing fails");
    await h.a.store.edit(async data => expect(data.chats[0]?.aliasId).toBe(spare));
  });
  it("saves immediately while a sync RPC is blocked, then resumes across reload without duplicates", async () => {
    const h = harness(true, true, true);
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const original = h.protocol.reads.messaging.get_private_devices;
    vi.spyOn(h.protocol.reads.messaging, "get_private_devices").mockImplementationOnce(async args => { entered(); await held; return original(args); });
    const syncing = h.a.service.sync(); await started;
    try {
      await h.a.service.queueMessage(bob.account, "Saved while offline");
      expect(h.a.snapshot.chats[0]?.messages[0]?.text).toBe("Saved while offline");
      await h.a.store.drafts(drafts => expect(drafts[0]?.text).toBe("Saved while offline"));
    } finally { release(); await syncing; }
    h.a.reload(); await h.pump(10);
    expect(h.b.snapshot.chats[0]?.messages.filter(m => m.text === "Saved while offline")).toHaveLength(1);
    await h.pump();
    expect(h.b.snapshot.chats[0]?.messages).toHaveLength(1);
  });
  it("serializes drafts from two tabs without dropping either message", async () => {
    const h = harness(true, true, true);
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const other = h.a.anotherTab(); await other.load();
    await Promise.all([h.a.service.queueMessage(bob.account, "First tab"), other.queueMessage(bob.account, "Second tab")]);
    await h.pump(12); other.stop();
    expect(h.b.snapshot.chats[0]?.messages.map(m => m.text).sort()).toEqual(["First tab", "Second tab"]);
    expect(h.packets.filter(p => p.peer)).toHaveLength(2);
  });
  it("reports corrupt queued data instead of silently hiding unsent messages", async () => {
    const h = harness(); await h.a.initialized;
    await h.a.storage.set(`${h.a.store.name}:drafts`, { version: 1, ciphertext: "broken" });
    await expect(h.a.service.load()).rejects.toThrow();
  });
  it("does not auto-connect or allocate credits to a blocked sender", async () => {
    const h = harness(true, true, true);
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    await h.a.service.start(bob.account);
    await h.a.service.load(); await h.a.service.sync();
    const before = h.operations.length;
    vi.spyOn(h.protocol.reads.relationships, "is_blocked").mockResolvedValue({ value: true });
    await h.b.service.sync();
    expect(h.b.snapshot.chats).toHaveLength(0);
    expect(h.operations.slice(before).filter(op => op.method === "open_private_channel" || op.method === "reserve_private_usage")).toHaveLength(0);
  });
  it("converges when both people send their first message at the same time", async () => {
    const h = harness(true, true, true);
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    await Promise.all([h.a.service.queueMessage(bob.account, "From Alice"), h.b.service.queueMessage(alice.account, "From Bob")]);
    await h.pump(12);
    const ac = h.a.snapshot.chats.filter(c => c.status === "ready"), bc = h.b.snapshot.chats.filter(c => c.status === "ready");
    expect(ac).toHaveLength(1); expect(bc).toHaveLength(1);
    expect(ac[0]?.id).toBe(bc[0]?.id);
    expect(ac[0]?.messages.some(m => !m.mine && m.text === "From Bob")).toBe(true);
    expect(bc[0]?.messages.some(m => !m.mine && m.text === "From Alice")).toBe(true);
  });
  it("recovers draft routing if storage fails while merging simultaneous introductions", async () => {
    const h = harness(true, true, true);
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    let failed = false;
    for (const browser of [h.a, h.b]) {
      const original = browser.store.drafts.bind(browser.store);
      vi.spyOn(browser.store, "drafts").mockImplementation(action => original(drafts => {
        const before = structuredClone(drafts);
        const result = action(drafts);
        if (!failed && drafts.some(d => before.some(old => old.id === d.id && old.chatId && d.chatId && old.chatId !== d.chatId))) {
          failed = true; throw new Error("Merge queue write failed");
        }
        return result;
      }));
    }
    await Promise.all([h.a.service.queueMessage(bob.account, "Alice despite storage failure"), h.b.service.queueMessage(alice.account, "Bob despite storage failure")]);
    await h.pump(12);
    expect(failed).toBe(true);
    expect(h.a.snapshot.chats.find(c => c.status === "ready")?.messages.some(m => !m.mine && m.text === "Bob despite storage failure")).toBe(true);
    expect(h.b.snapshot.chats.find(c => c.status === "ready")?.messages.some(m => !m.mine && m.text === "Alice despite storage failure")).toBe(true);
  });
  it("does not reconnect a closed conversation to deliver an unsent first message", async () => {
    const h = harness(true, true, true);
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    await h.a.service.queueMessage(bob.account, "Cancelled draft");
    const pending = h.a.snapshot.chats.find(c => c.status !== "closed")!.id;
    await h.a.service.close(pending); await h.pump(10);
    expect(h.a.snapshot.chats.every(c => c.status === "closed")).toBe(true);
    expect(h.b.snapshot.chats.every(c => c.status === "closed")).toBe(true);
    expect(h.a.snapshot.chats.flatMap(c => c.messages)).toContainEqual(expect.objectContaining({ text: "Cancelled draft", state: "not-sent" }));
    await h.a.store.drafts(drafts => expect(drafts).toHaveLength(0));
    expect(h.packets.filter(p => p.peer)).toHaveLength(0);
  });
  it("recovers a committed ratchet after queue cleanup fails without encrypting or delivering twice", async () => {
    const h = harness(true, true, true);
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    await h.a.service.queueMessage(bob.account, "Exactly once");
    const set = h.a.storage.set.bind(h.a.storage);
    let failed = false;
    h.a.storage.set = async (key, value) => {
      if (!failed && key === `${h.a.store.name}:drafts` && h.packets.some(p => p.actor !== h.a.snapshot.chats[0]?.peer && !p.peer) && h.channels.size) {
        failed = true; throw new Error("Simulated queue cleanup failure");
      }
      return set(key, value);
    };
    await h.pump(10); h.a.reload(); await h.pump();
    expect(failed).toBe(true);
    expect(h.b.snapshot.chats[0]?.messages.filter(m => m.text === "Exactly once")).toHaveLength(1);
    expect(h.packets.filter(p => p.peer)).toHaveLength(1);
    await h.a.store.drafts(drafts => expect(drafts).toHaveLength(0));
  });
  it("connects at testnet inclusion and pipelines messages before finality", async () => {
    const h = harness(true, true);
    h.setLib("1"); h.setHead("4");
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const chat = await h.a.service.start(bob.account);
    await h.pump();
    expect(h.b.snapshot.chats).toHaveLength(0);
    h.setHead("5"); await h.pump();
    expect(h.b.snapshot.chats[0]?.status).toBe("incoming");
    await h.b.service.accept(chat);
    for (let i = 0; i < 3; i++) { await h.b.service.load(); await h.b.service.sync(); }
    expect(h.b.snapshot.chats[0]?.progress).toBe("Your side is ready. Waiting for the other account to finish confirming the connection.");
    await h.pump(8);
    expect(h.a.snapshot.chats[0]?.status).toBe("ready");
    expect(h.b.snapshot.chats[0]?.status).toBe("ready");
    await h.a.service.send(chat, "first");
    await h.a.service.send(chat, "second");
    await h.pump();
    expect(h.b.snapshot.chats[0]?.messages.map(m => m.text)).toEqual(["first", "second"]);
    expect(h.b.snapshot.chats[0]?.messages.every(m => m.state === "confirming")).toBe(true);
    const headReads = vi.spyOn(h.protocol.provider, "getHeadInfo");
    await h.a.service.sync();
    expect(headReads).toHaveBeenCalledTimes(1);
    headReads.mockRestore();
    await h.b.store.edit(async data => {
      expect(data.inboxAfter).toBe("0"); expect(data.chats[0]?.after).toBe("0");
    });
    await h.a.store.edit(async data => expect(data.outbox.filter(p => p.peer)).toHaveLength(2));
    h.b.reload(); await h.pump();
    expect(h.b.snapshot.chats[0]?.messages).toHaveLength(2);
    h.setLib("7"); await h.pump();
    expect(h.a.snapshot.pending).toBe(0);
    expect(h.b.snapshot.chats[0]?.messages.every(m => m.state === "sent")).toBe(true);
  });
  it("keeps sending beyond twenty observed messages while finality is still pending", async () => {
    const h = harness(true, true), chat = await h.connect();
    h.setLib("1"); h.setHead("5");
    for (let i = 0; i < 25; i++) {
      await h.a.service.queueMessage(bob.account, `Message ${i + 1}`); await h.pump(2);
    }
    expect(h.b.snapshot.chats[0]?.messages).toHaveLength(25);
    expect(h.a.snapshot.pending).toBe(0);
    await h.a.store.edit(async data => expect(data.outbox.filter(p => p.peer)).toHaveLength(25));
    await h.a.store.drafts(drafts => expect(drafts).toHaveLength(0));
    expect(h.a.snapshot.chats.find(c => c.id === chat)?.error).toBeUndefined();
  });
  it("rebroadcasts identical ciphertext after a testnet reorg without repeating ratchet decryption", async () => {
    const h = harness(true, true), chat = await h.connect();
    h.setLib("1"); h.setHead("7");
    // Move this conversation's stable cursor before the reversible message.
    await h.a.service.send(chat, "survives a reorg"); await h.pump();
    const original = structuredClone(h.packets.find(p => !!p.peer)!);
    expect(h.b.snapshot.chats[0]?.messages).toHaveLength(1);
    h.packets.splice(h.packets.findIndex(p => p.packet_id === original.packet_id), 1);
    h.a.reload(); h.b.reload(); await h.pump();
    const replay = h.packets.find(p => p.packet_id === original.packet_id)!;
    expect(replay.envelope).toBe(original.envelope);
    expect(h.b.snapshot.chats[0]?.messages).toHaveLength(1);
    expect(h.b.snapshot.error).toBe("");
    await h.b.service.send(chat, "ratchet still works"); await h.pump();
    expect(h.a.snapshot.chats[0]?.messages.at(-1)?.text).toBe("ratchet still works");
  });
  it("finds a replacement invitation when a reversible sequence is reused", async () => {
    const h = harness(true, true);
    h.setLib("1"); h.setHead("7");
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const old = await h.a.service.start(bob.account); await h.pump();
    expect(h.b.snapshot.chats[0]?.id).toBe(old);
    h.packets.length = 0;
    // Simulate an offline old sender, then a fresh independent invitation.
    await h.a.store.edit(async data => { data.outbox = []; data.chats[0]!.status = "closed"; data.chats[0]!.closeNotice = "sent"; });
    const fresh = await h.a.service.start(bob.account); await h.pump();
    expect(h.packets[0]?.sequence).toBe("1");
    expect(h.b.snapshot.chats.some(c => c.id === fresh)).toBe(true);
    expect(fresh).not.toBe(old);
  });
  it("uses the advertised testnet allowance policy and repairs an orphaned grant without a second charge", async () => {
    let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now);
    const h = harness(false, true);
    h.setLib("1"); h.setHead("6");
    vi.spyOn(SponsorClient.prototype, "discover").mockResolvedValue({
      sponsor: deployment.contracts.sponsorship.address,
      policy: { privateUsageConfirmations: 3, allowed: [{ contract: scope.contract, entryPoints: [ABIS.messaging.methods.reserve_private_usage!.entry_point] }] },
    } as any);
    const allocate = vi.spyOn(SponsorClient.prototype, "allocatePrivateUsage").mockImplementation(async payload => {
      h.allocate(payload.reservationId, payload.actor, payload.signature);
      return { grantId: payload.reservationId, pending: true };
    });
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    await h.a.service.start(bob.account); await h.pump();
    expect(allocate).not.toHaveBeenCalled();
    h.setHead("7"); await h.pump(8);
    expect(h.a.snapshot.error).toBe("");
    expect(h.b.snapshot.chats[0]?.status).toBe("incoming");
    expect(allocate).toHaveBeenCalledTimes(1);
    h.packets.length = 0; h.grants.clear(); h.units.clear(); now += 60_000;
    h.a.reload(); await h.pump(8);
    expect(allocate).toHaveBeenCalledTimes(2);
    expect(h.operations.filter(op => op.method === "reserve_private_usage")).toHaveLength(1);
    expect(allocate.mock.calls[1]?.[0].reservationId).toBe(allocate.mock.calls[0]?.[0].reservationId);
    expect(h.packets).toHaveLength(1);
    expect(h.b.snapshot.chats).toHaveLength(1);
  });
  it.each(["sender", "recipient"])("delivers %s cancellation before a channel exists", async side => {
    const h = harness();
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const chat = await h.a.service.start(bob.account);
    await h.pump();
    expect(h.b.snapshot.chats[0]?.status).toBe("incoming");
    await (side === "sender" ? h.a : h.b).service.close(chat);
    await h.pump();
    expect(h.a.snapshot.chats[0]?.status).toBe("closed");
    expect(h.b.snapshot.chats[0]?.status).toBe("closed");
    expect(h.a.snapshot.pending + h.b.snapshot.pending).toBe(0);
  });
  it("repairs a locally closed legacy request without closing a new request to the same person", async () => {
    const h = harness();
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const old = await h.a.service.start(bob.account); await h.pump();
    await h.a.store.edit(async data => {
      data.chats[0]!.status = "closed";
      delete data.chats[0]!.setup; delete data.chats[0]!.returnSecret;
      delete data.chats[0]!.invitation;
      data.outbox = [];
    });
    h.a.reload();
    const fresh = await h.a.service.start(bob.account);
    expect(fresh).not.toBe(old);
    await h.pump(8);
    expect(h.b.snapshot.chats.find(c => c.id === old)?.status).toBe("closed");
    expect(h.b.snapshot.chats.find(c => c.id === fresh)?.status).toBe("incoming");
    await h.b.service.accept(fresh); await h.pump(8);
    expect(h.a.snapshot.chats.find(c => c.id === fresh)?.status).toBe("ready");
    expect(h.b.snapshot.chats.find(c => c.id === fresh)?.status).toBe("ready");
  });
  it("cancels during acceptance, ignores a late acceptance, then connects in the reverse direction", async () => {
    const h = harness();
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const old = await h.a.service.start(bob.account); await h.pump();
    await h.b.service.accept(old); await h.b.service.load();
    await h.a.service.close(old); await h.pump(8);
    expect(h.a.snapshot.chats[0]?.status).toBe("closed");
    expect(h.b.snapshot.chats[0]?.status).toBe("closed");
    const fresh = await h.b.service.start(alice.account); await h.pump();
    await h.a.service.accept(fresh); await h.pump(8);
    await h.b.service.send(fresh, "new conversation"); await h.pump();
    expect(h.a.snapshot.chats.find(c => c.id === fresh)?.messages[0]?.text).toBe("new conversation");
    await h.a.store.edit(async data => {
      const closed = data.chats.find(c => c.id === old)!;
      expect(closed.ratchet).toBeUndefined(); expect(closed.setup).toBeUndefined();
      expect(closed.returnSecret).toBeUndefined(); expect(closed.invitation).toBeUndefined();
    });
  });
  it("does not resurrect an invitation delivered after its cancellation", async () => {
    const h = harness();
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    await h.a.service.start(bob.account); await h.a.service.load();
    const chat = h.a.snapshot.chats[0]!.id;
    await h.a.service.close(chat);
    for (let i = 0; i < 4; i++) { await h.a.service.load(); await h.a.service.sync(); }
    expect(h.packets).toHaveLength(2);
    h.packets.reverse().forEach((packet, i) => { packet.sequence = String(i + 1); });
    await h.pump();
    expect(h.b.snapshot.chats).toHaveLength(0);
    await h.b.store.edit(async data => expect(data.closedRequests?.[0]?.id).toBe(chat));
  });
  it("persists close notices through an unknown broadcast and reload without duplicates", async () => {
    const h = harness();
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const chat = await h.a.service.start(bob.account); await h.pump();
    h.setUnknown();
    await h.b.service.close(chat); await h.b.service.load();
    h.b.reload(); await h.b.service.close(chat); await h.pump(6);
    expect(h.packets).toHaveLength(2);
    expect(h.b.snapshot.chats[0]?.closing).toBeUndefined();
    expect(h.a.snapshot.chats[0]?.status).toBe("closed");
    expect(fromBase64url(h.packets[1]!.envelope).length).toBe(4168);
    expect(h.packets[1]!.peer).toBe("");
  });
  it("notifies every registered peer browser without exposing the public recipient", async () => {
    const h = harness();
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const chat = await h.a.service.start(bob.account); await h.pump();
    const device = h.devices.get(bob.account)![0]!;
    h.devices.get(bob.account)!.push({ ...device, device_id: randomBytes(32) });
    await h.a.service.close(chat); await h.pump(6);
    expect(h.packets).toHaveLength(3);
    expect(h.packets.slice(1).every(p => !p.peer && fromBase64url(p.envelope).length === 4168)).toBe(true);
    expect(h.a.snapshot.pending).toBe(0);
    expect(h.b.snapshot.chats[0]?.status).toBe("closed");
  });
  it("rejects a forged cancellation even when encrypted to the right browser", async () => {
    const h = harness();
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const chat = await h.a.service.start(bob.account); await h.pump();
    const device = h.devices.get(bob.account)![0]!;
    const packetId = toBase64url(randomBytes(32));
    const value = { kind: "close", id: chat, from: alice.account, to: bob.account, createdAt: Date.now() };
    const envelope = sealPrivateInvitation({ ...scope, actor: bob.account, peer: "", packetId }, device.delivery_key,
      { value, signature: await signPrivateStatement(scope, "close", value, bob.signer) });
    h.packets.push({ actor: bob.account, peer: "", packet_id: packetId, envelope: toBase64url(envelope), content_hash: toBase64url(contentHash(envelope)),
      sequence: String(h.packets.length + 1), timestamp: String(Date.now()), block: "5", txId: "forged" });
    await h.pump();
    expect(h.b.snapshot.chats[0]?.status).toBe("incoming");
  });
  it("rescans a cancellation skipped by an older browser during a staggered upgrade", async () => {
    const h = harness();
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const chat = await h.a.service.start(bob.account); await h.pump();
    await h.a.service.close(chat);
    for (let i = 0; i < 4; i++) { await h.a.service.load(); await h.a.service.sync(); }
    await h.b.store.edit(async data => {
      data.inboxAfter = h.packets.at(-1)!.sequence;
      data.inboxValidation = 1;
    });
    h.b.reload(); await h.pump();
    expect(h.b.snapshot.chats[0]?.status).toBe("closed");
  });
  it("uses one finality boundary for an inbox batch without advancing past an unconfirmed cancellation", async () => {
    const h = harness();
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const chat = await h.a.service.start(bob.account); await h.a.service.load();
    await h.a.service.close(chat);
    for (let i = 0; i < 4; i++) { await h.a.service.load(); await h.a.service.sync(); }
    expect(h.packets).toHaveLength(2);
    h.packets[0]!.block = "1";
    h.setLib("1");
    const head = vi.spyOn(h.protocol.provider, "getHeadInfo");
    await h.b.service.sync();
    expect(head).toHaveBeenCalledTimes(1);
    expect(h.b.snapshot.chats[0]?.status).toBe("incoming");
    await h.b.store.edit(async data => expect(data.inboxAfter).toBe(h.packets[0]!.sequence));
    h.setLib("1000"); await h.pump();
    expect(h.b.snapshot.chats[0]?.status).toBe("closed");
  });
  it("reports funding failure on the request and still dispatches while the inbox is unavailable", async () => {
    const h = harness(false);
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const discovery = vi.spyOn(SponsorClient.prototype, "discover").mockRejectedValue(new Error("offline"));
    vi.spyOn(h.indexer, "privatePackets").mockRejectedValue(new Error("Indexer offline"));
    await h.a.service.start(bob.account); await h.a.service.load();
    expect(h.a.snapshot.chats[0]?.requestDelivery).toBe("failed");
    expect(h.a.snapshot.chats[0]?.error).toContain("sponsor");
    expect(discovery).toHaveBeenCalled();
  });
  it("reuses one allowance for acceptance and channel opening without reusing an unmined nonce", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const h = harness(false);
    vi.spyOn(SponsorClient.prototype, "discover").mockResolvedValue({
      sponsor: deployment.contracts.sponsorship.address,
      policy: { allowed: [{ contract: scope.contract, entryPoints: [ABIS.messaging.methods.reserve_private_usage!.entry_point] }] },
    } as any);
    vi.spyOn(SponsorClient.prototype, "allocatePrivateUsage").mockImplementation(async payload => {
      h.allocate(payload.reservationId, payload.actor, payload.signature);
      return { grantId: payload.reservationId, pending: true };
    });
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const chat = await h.a.service.start(bob.account);
    for (let i = 0; i < 5; i++) { now += 60_000; await h.pump(2); }
    expect(h.b.snapshot.chats[0]?.status).toBe("incoming");
    h.delayNonceUntilInclusion();
    await h.b.service.accept(chat);
    // Wait behind acceptance's background sync without starting a new retry.
    await h.b.service.load();
    expect(h.b.snapshot.error).toBe("");
    const reservations = h.operations.filter(op => op.method === "reserve_private_usage" && op.signer === bob.account);
    expect(reservations.map(op => op.args.units)).toEqual([4]);
    expect(new Set(reservations.map(op => toBase64url(op.args.reservation_id))).size).toBe(1);
  });
  it.each(["expired", "future-dated"] as const)("does not surface a correctly signed but %s invitation", async scenario => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const h = harness();
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    await h.a.service.start(bob.account);
    // Publish without letting the receiving browser scan yet.
    for (let i = 0; i < 3; i++) { await h.a.service.load(); await h.a.service.sync(); }
    expect(h.packets).toHaveLength(1);
    if (scenario === "expired") now += 8 * 86_400_000;
    else h.packets[0]!.timestamp = String(now - 6 * 60_000);
    await h.pump(2);
    expect(h.b.snapshot.chats).toHaveLength(0);
    expect(h.b.snapshot.error).toBe("");
  });
  it("delivers a saved request after a long funding wait without another reservation", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const h = harness(false);
    const sponsor = deployment.contracts.sponsorship.address;
    vi.spyOn(SponsorClient.prototype, "discover").mockResolvedValue({
      sponsor, policy: { allowed: [{ contract: scope.contract, entryPoints: [ABIS.messaging.methods.reserve_private_usage!.entry_point] }] },
    } as any);
    const allocate = vi.spyOn(SponsorClient.prototype, "allocatePrivateUsage").mockImplementation(async payload => {
      h.allocate(payload.reservationId, payload.actor, payload.signature);
      return { grantId: payload.reservationId, pending: true };
    });
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    h.setLib("1");
    const chat = await h.a.service.start(bob.account);
    await h.pump(2);
    expect(h.a.snapshot.chats[0]?.requestDelivery).toBe("preparing");
    expect(h.b.snapshot.chats).toHaveLength(0);
    expect(h.reservations.size).toBe(1);
    expect(allocate).not.toHaveBeenCalled();
    now += 10 * 60_000;
    h.a.reload();
    h.setLib("1000");
    await h.pump(8);
    expect(h.a.snapshot.error).toBe(""); expect(h.b.snapshot.error).toBe("");
    expect(h.b.snapshot.chats[0]?.id).toBe(chat);
    expect(h.b.snapshot.chats[0]?.status).toBe("incoming");
    expect(h.a.snapshot.chats[0]?.requestDelivery).toBe("sent");
    expect(h.reservations.size).toBe(1);
    expect(allocate).toHaveBeenCalledTimes(1);
    expect(h.operations.filter(o => o.method === "reserve_private_usage")).toHaveLength(1);
    expect(h.packets).toHaveLength(1);
    // Upgrade a recipient whose old client already skipped this delayed request.
    await h.b.store.edit(async data => {
      data.chats = [];
      delete data.inboxValidation;
      data.inboxAfter = h.packets[0]!.sequence;
    });
    h.b.reload();
    await h.pump(2);
    expect(h.b.snapshot.chats).toHaveLength(1);
    expect(h.b.snapshot.chats[0]?.id).toBe(chat);
    await h.b.service.accept(chat);
    for (let i = 0; i < 6; i++) {
      now += 60_000;
      await h.pump(3);
    }
    expect(h.a.snapshot.chats[0]?.status).toBe("ready");
    expect(h.b.snapshot.chats[0]?.status).toBe("ready");
    await h.a.service.send(chat, "After a delayed invitation");
    await h.pump();
    expect(h.b.snapshot.chats[0]?.messages[0]?.text).toBe("After a delayed invitation");
  });
  it("registers first-time browsers from an empty wire response and resumes after a real read failure", async () => {
    const h = harness();
    h.setDirectoryDown(true);
    await h.a.service.enable();
    await h.pump(2);
    expect(h.a.snapshot.enabled).toBe(true);
    expect(h.a.snapshot.registered).toBe(false);
    expect(h.a.snapshot.error).toBe("Directory RPC unavailable");
    expect(h.operations).toHaveLength(0);
    h.a.reload();
    h.setDirectoryDown(false);
    await h.pump(3);
    expect(h.a.snapshot.registered).toBe(true);
    expect(h.a.snapshot.error).toBe("");
    expect(h.operations.filter(op => op.method === "set_private_device")).toHaveLength(1);
  });
  it("authenticates a private introduction and exchanges messages without public profile routing", async () => {
    const h = harness(),
      chat = await h.connect();
    await h.a.service.send(chat, "Hello privately");
    await h.pump();
    await h.b.service.send(chat, "Hello back");
    await h.pump();
    expect(h.a.snapshot.chats[0]?.messages.map((m) => m.text)).toEqual([
      "Hello privately",
      "Hello back",
    ]);
    expect(h.b.snapshot.chats[0]?.messages.map((m) => m.text)).toEqual([
      "Hello privately",
      "Hello back",
    ]);
    const routed = h.operations.filter((o) =>
      ["post_private_packet", "open_private_channel"].includes(o.method),
    );
    for (const op of routed) {
      expect(op.signer).not.toBe(alice.account);
      expect(op.signer).not.toBe(bob.account);
      expect(op.args.actor).not.toBe(alice.account);
      expect(op.args.peer).not.toBe(bob.account);
    }
    await h.a.store.edit(async (d) => {
      expect(d.chats[0]?.setup).toBeUndefined();
      expect(d.chats[0]?.returnSecret).toBeUndefined();
    });
    await h.b.store.edit(async (d) =>
      expect(d.chats[0]?.invitation).toBeUndefined(),
    );
  });
  it("survives an unknown broadcast and reload without creating new ciphertext or duplicate history", async () => {
    const h = harness(),
      chat = await h.connect();
    h.setUnknown();
    await h.a.service.send(chat, "one message");
    await h.a.service.load();
    h.a.reload();
    await h.pump();
    expect(h.packets.filter((p) => !!p.peer)).toHaveLength(1);
    expect(h.a.snapshot.pending).toBe(0);
    expect(h.b.snapshot.chats[0]?.messages).toHaveLength(1);
    expect(h.a.snapshot.chats[0]?.messages[0]?.state).toBe("sent");
    await h.a.service.send(chat, "second message");
    await h.pump();
    expect(h.b.snapshot.chats[0]?.messages.map((m) => m.text)).toEqual([
      "one message",
      "second message",
    ]);
  });
  it("does not consume receiving keys or discard outgoing ciphertext before finality", async () => {
    const h = harness(),
      chat = await h.connect();
    h.setLib("1");
    await h.a.service.send(chat, "wait for finality");
    await h.pump();
    expect(h.a.snapshot.pending).toBe(1);
    expect(h.b.snapshot.chats[0]?.messages).toHaveLength(0);
    h.setLib("1000");
    await h.pump();
    expect(h.b.snapshot.chats[0]?.messages[0]?.text).toBe("wait for finality");
    expect(h.a.snapshot.pending).toBe(0);
  });
  it("refuses to sign or advance state while the browser is locked", async () => {
    const h = harness(),
      chat = await h.connect(),
      before = h.operations.length;
    h.a.lock();
    await expect(h.a.service.send(chat, "must not send")).rejects.toThrow(
      "Unlock",
    );
    expect(h.operations).toHaveLength(before);
  });
  it("serializes concurrent sends from two tabs without reusing a ratchet state", async () => {
    const h = harness(),
      chat = await h.connect(),
      second = h.a.anotherTab();
    await Promise.all([
      h.a.service.send(chat, "tab one"),
      second.send(chat, "tab two"),
    ]);
    await h.pump(8);
    second.stop();
    expect(h.b.snapshot.chats[0]?.messages.map((m) => m.text).sort()).toEqual([
      "tab one",
      "tab two",
    ]);
    const delivered = h.packets.filter((p) => !!p.peer);
    expect(new Set(delivered.map((p) => p.packet_id)).size).toBe(2);
    expect(new Set(delivered.map((p) => p.envelope)).size).toBe(2);
  });
  it("never broadcasts a message whose advanced ratchet failed to persist", async () => {
    const h = harness(),
      chat = await h.connect(),
      before = h.operations.length;
    const set = h.a.storage.set;
    h.a.storage.set = async () => {
      throw new Error("disk full");
    };
    await expect(h.a.service.send(chat, "must not publish")).rejects.toThrow(
      "disk full",
    );
    expect(h.operations).toHaveLength(before);
    h.a.storage.set = set;
    await h.a.service.load();
    expect(h.a.snapshot.chats[0]?.messages).toHaveLength(0);
    await h.a.service.send(chat, "storage recovered");
    await h.pump();
    expect(h.b.snapshot.chats[0]?.messages.map((m) => m.text)).toEqual([
      "storage recovered",
    ]);
  });
  it("queues messages locally while offline and checks blocks before any broadcast", async () => {
    const h = harness(), chat = await h.connect();
    const before = h.packets.length;
    const blocked = vi.spyOn(h.protocol.reads.relationships, "is_blocked").mockRejectedValue(new Error("offline"));
    await h.a.service.send(chat, "queued offline");
    await h.a.service.load();
    expect(h.a.snapshot.chats[0]?.messages[0]?.text).toBe("queued offline");
    expect(h.a.snapshot.chats[0]?.messages[0]?.state).toBe("sending");
    expect(h.packets).toHaveLength(before);
    blocked.mockResolvedValue({ value: true }); await h.pump();
    expect(h.packets).toHaveLength(before);
    expect(h.a.snapshot.chats[0]?.error).toContain("blocked");
    blocked.mockRestore(); await h.pump();
    expect(h.b.snapshot.chats[0]?.messages.map(m => m.text)).toEqual(["queued offline"]);
  });
  it("keeps the receiving ratchet until a remote close is irreversible", async () => {
    const h = harness(),
      chat = await h.connect();
    h.setLib("1");
    await h.a.service.close(chat);
    await h.pump();
    await h.b.store.edit(async (d) =>
      expect(d.chats[0]?.ratchet).toBeDefined(),
    );
    h.setLib("1000");
    await h.pump();
    expect(h.b.snapshot.chats[0]?.status).toBe("closed");
    await h.b.store.edit(async (d) =>
      expect(d.chats[0]?.ratchet).toBeUndefined(),
    );
  });
  it("retains the visible inbox through a storage read failure and resumes without duplicating messages", async () => {
    const h = harness(), chat = await h.connect();
    await h.a.service.send(chat, "Keep my history visible"); await h.pump();
    const get = h.a.storage.get.bind(h.a.storage);
    const failure = vi.spyOn(h.a.storage, "get").mockImplementation(async key => {
      if (key === h.a.store.name) throw new Error("Temporary storage read failure");
      return get(key);
    });
    await h.a.service.sync();
    expect(h.a.snapshot.enabled).toBe(true);
    expect(h.a.snapshot.chats[0]?.messages[0]?.text).toBe("Keep my history visible");
    expect(h.a.snapshot.error).toContain("Temporary storage read failure");
    failure.mockRestore(); await h.pump();
    expect(h.a.snapshot.error).toBe("");
    expect(h.b.snapshot.chats[0]?.messages).toHaveLength(1);
  });
  it("archives a never-submitted placeholder and preserves its draft if the archive write fails", async () => {
    const h = harness(); await h.a.initialized; await h.a.service.load();
    await h.a.service.queueMessage(bob.account, "Not lost when I close");
    await h.a.service.load();
    const set = h.a.storage.set.bind(h.a.storage);
    const failure = vi.spyOn(h.a.storage, "set").mockImplementation(async (key, value) => {
      if (key === h.a.store.name) throw new Error("Archive storage unavailable");
      return set(key, value);
    });
    await expect(h.a.service.close(`pending:${bob.account}`)).rejects.toThrow("Archive storage unavailable");
    await h.a.store.drafts(drafts => expect(drafts[0]?.text).toBe("Not lost when I close"));
    failure.mockRestore(); await h.a.service.close(`pending:${bob.account}`); h.a.reload(); await h.a.service.load();
    expect(h.a.snapshot.chats[0]).toMatchObject({ status: "closed", messages: [{ text: "Not lost when I close", state: "not-sent" }] });
    await h.a.store.drafts(drafts => expect(drafts).toHaveLength(0));
    expect(h.operations).toHaveLength(0);
  });
  it("lets an established recipient return after the sender has closed, without requiring a receipt wait", async () => {
    const h = harness(true, true), chat = await h.connect();
    h.b.service.stop(); h.setLib("1"); h.setHead("5");
    const submit = h.protocol.submit.bind(h.protocol);
    const sent = vi.spyOn(h.protocol, "submit").mockImplementation(async options => {
      if (options.operations.some((op: any) => op.method === "post_private_packet")) {
        expect(options.waitForReceipt).toBe(false);
      }
      return submit(options);
    });
    await h.a.service.queueMessage(bob.account, "Waiting on chain while you are away");
    await h.a.service.load(); await h.a.service.sync();
    expect(sent).toHaveBeenCalled();
    expect(h.b.snapshot.chats[0]?.messages).toHaveLength(0);
    h.a.service.stop(); h.b.reload(); await h.b.service.load(); await h.b.service.sync();
    expect(h.b.snapshot.chats[0]?.messages).toContainEqual(expect.objectContaining({ text: "Waiting on chain while you are away", mine: false }));
    await h.b.service.sync();
    expect(h.b.snapshot.chats[0]?.messages).toHaveLength(1);
  });
  it("recovers a placeholder close after draft cleanup fails without creating another archive", async () => {
    const h = harness(); await h.a.initialized; await h.a.service.load();
    await h.a.service.queueMessage(bob.account, "Archive once"); await h.a.service.load();
    const set = h.a.storage.set.bind(h.a.storage);
    const failure = vi.spyOn(h.a.storage, "set").mockImplementation(async (key, value) => {
      if (key === `${h.a.store.name}:drafts`) throw new Error("Draft cleanup interrupted");
      return set(key, value);
    });
    await expect(h.a.service.close(`pending:${bob.account}`)).rejects.toThrow("Draft cleanup interrupted");
    failure.mockRestore(); await h.a.service.close(`pending:${bob.account}`);
    expect(h.a.snapshot.chats).toHaveLength(1);
    expect(h.a.snapshot.chats[0]?.messages).toHaveLength(1);
    await h.a.store.drafts(drafts => expect(drafts).toHaveLength(0));
  });
  it("keeps later packets behind an unobserved alias transaction even after the HTTP response", async () => {
    const h = harness(true, true), chat = await h.connect();
    const submit = h.protocol.submit.bind(h.protocol);
    let held: PrivatePacketView | undefined;
    const sent = vi.spyOn(h.protocol, "submit").mockImplementation(async options => {
      const result = await submit(options);
      if (options.operations.some((op: any) => op.method === "post_private_packet")) held = h.packets.pop();
      return result;
    });
    await h.a.service.queueMessage(bob.account, "First");
    await h.a.service.queueMessage(bob.account, "Second");
    await h.a.service.load(); await h.a.service.sync(); await h.a.service.sync();
    expect(sent).toHaveBeenCalledTimes(1);
    expect(h.a.snapshot.chats[0]?.messages[0]?.state).toBe("submitted");
    sent.mockRestore(); h.packets.push(held!); await h.pump();
    expect(h.b.snapshot.chats[0]?.messages.map(m => m.text)).toEqual(["First", "Second"]);
  });
  it("reuses prepaid conversation credits for closure and hides only its finality wait", async () => {
    const h = harness(true, true), chat = await h.connect();
    const actor = await h.a.store.edit(async data => data.chats[0]!.alias);
    h.setLib("1"); h.setHead("5");
    await h.a.service.close(chat); await h.pump();
    const closed = h.a.snapshot.chats[0]!;
    expect(closed.status).toBe("closed"); expect(closed.closing).toBeUndefined();
    await h.a.store.edit(async data => {
      expect(data.outbox.filter(p => p.kind === "close")).toHaveLength(1);
      expect(data.outbox[0]).toMatchObject({ actor, purpose: "conversation", observed: true });
      expect(data.chats[0]?.closeChannelPending).toBe(true);
    });
    const original = h.packets.find(p => !p.peer && p.actor === actor && p.packet_id !== chat && p.sequence !== "1")!;
    h.packets.splice(h.packets.indexOf(original), 1);
    await h.a.service.sync(); await h.a.service.sync();
    expect(h.packets.filter(p => p.packet_id === original.packet_id)).toHaveLength(1);
    expect(h.packets.find(p => p.packet_id === original.packet_id)?.envelope).toBe(original.envelope);
    h.setLib("1000"); await h.pump();
    await h.a.store.edit(async data => expect(data.outbox).toHaveLength(0));
  });
});

describe("linked messaging browsers", () => {
  type Browser = ReturnType<ReturnType<typeof harness>["device"]>;
  async function pump(browsers: Browser[], n = 8) {
    for (let i = 0; i < n; i++) for (const browser of browsers) {
      await browser.service.load(); await browser.service.sync();
    }
  }
  async function add(h: ReturnType<typeof harness>, identity = alice) {
    const browser = h.device(identity); await browser.initialized;
    await browser.service.enable(); await pump([browser], 2); return browser;
  }
  async function link(a: Browser, phone: Browser) {
    await a.service.linkDevice(phone.snapshot.deviceId!);
    await pump([a, phone], 4);
    const request = phone.snapshot.links!.find(l => l.status === "incoming")!;
    expect(request).toBeDefined();
    expect(a.snapshot.links!.find(l => l.status === "outgoing")?.id).toBe(request.id);
    await phone.service.accept(request.id);
    await pump([a, phone], 12);
    expect(a.snapshot.links!.some(l => l.status === "ready")).toBe(true);
    expect(phone.snapshot.links!.some(l => l.status === "ready")).toBe(true);
    expect(a.snapshot.error).toBe(""); expect(phone.snapshot.error).toBe("");
  }
  it("requires explicit approval despite auto-connect, copies existing history, and never exports the live session", async () => {
    const h = harness(); const chat = await h.connect();
    await h.a.service.send(chat, "Earlier desktop message"); await h.pump();
    const phone = await add(h);
    await phone.service.setAutoConnect(true);
    await pump([h.a, h.b, phone], 3);
    expect(phone.snapshot.chats).toHaveLength(0);
    await h.a.service.linkDevice(phone.snapshot.deviceId!);
    await pump([h.a, phone], 5);
    expect(phone.snapshot.links![0]!.status).toBe("incoming");
    expect(phone.snapshot.chats).toHaveLength(0);
    await phone.service.accept(phone.snapshot.links![0]!.id);
    await pump([h.a, phone], 12);
    expect(phone.snapshot.chats[0]?.messages.map(m => m.text)).toEqual(["Earlier desktop message"]);
    expect(phone.snapshot.chats[0]?.synced).toBe(true);
    await phone.store.edit(async data => {
      expect(data.chats.filter(c => !c.kind)).toHaveLength(0);
      expect(data.mirrors?.[0]?.messages[0]?.text).toBe("Earlier desktop message");
      expect(JSON.stringify(data.mirrors)).not.toMatch(/pickle|ratchet|secret|aliasId|returnKey/);
    });
    // Unchanged copies settle: no ever-growing echo loop between devices.
    const packets = h.packets.length; await pump([h.a, phone], 8);
    expect(h.packets.length).toBe(packets);
  });
  it("catches up after an offline browser returns, including long Unicode messages and reloads", async () => {
    const h = harness(); const chat = await h.connect(); const phone = await add(h);
    await link(h.a, phone);
    const long = "😀".repeat(600);
    await h.a.service.send(chat, long); await h.pump();
    await pump([h.a], 10); // phone is offline while the encrypted copies reach chain
    phone.reload(); await pump([phone], 10);
    expect(phone.snapshot.chats[0]?.messages.map(m => m.text)).toEqual([long]);
    expect(phone.snapshot.error).toBe("");
  });
  it("supports four browsers with independent sessions, replies from the phone, and one visible copy", async () => {
    const h = harness(); const root = await h.connect();
    await h.a.service.setAutoConnect(true); await h.b.service.setAutoConnect(true);
    const ap = await add(h), bp = await add(h, bob);
    await ap.service.setAutoConnect(true); await bp.service.setAutoConnect(true);
    await link(h.a, ap); await link(h.b, bp);
    await h.a.service.queueMessage(bob.account, "Desktop to both", root);
    await pump([h.a, h.b, ap, bp], 22);
    for (const browser of [h.a, h.b, ap, bp]) {
      expect(browser.snapshot.error).toBe("");
      expect(browser.snapshot.chats).toHaveLength(1);
      expect(browser.snapshot.chats[0]?.messages.map(m => m.text)).toEqual(["Desktop to both"]);
    }
    await ap.service.queueMessage(bob.account, "Reply from phone", root);
    await pump([ap, h.b, bp, h.a], 22);
    for (const browser of [h.a, h.b, ap, bp]) {
      expect(browser.snapshot.error).toBe("");
      expect(browser.snapshot.chats).toHaveLength(1);
      expect(browser.snapshot.chats[0]?.messages.map(m => m.text)).toEqual(["Desktop to both", "Reply from phone"]);
    }
    // Once the independent phone route exists, a sleeping desktop is not a gate.
    await h.b.service.queueMessage(alice.account, "Arrives while desktop is offline", root);
    await pump([h.b, bp, ap], 12);
    expect(ap.snapshot.chats[0]?.messages.at(-1)?.text).toBe("Arrives while desktop is offline");
    await pump([h.a], 6);
    expect(h.a.snapshot.chats[0]?.messages.filter(m => m.text === "Arrives while desktop is offline")).toHaveLength(1);
    const a = await h.a.store.edit(async data => data.chats.filter(c => !c.kind && c.status === "ready"));
    const b = await ap.store.edit(async data => data.chats.filter(c => !c.kind && c.status === "ready"));
    {
      expect(a.length).toBe(2); expect(b.length).toBe(2);
      for (const left of a) for (const right of b) {
        expect(left.alias).not.toBe(right.alias);
        expect(left.ratchet).not.toEqual(right.ratchet);
      }
    }
  }, 30000);
  it("stops copying after revocation and does not reauthorize a re-enabled browser", async () => {
    const h = harness(); const root = await h.connect(); const phone = await add(h);
    await link(h.a, phone);
    await h.a.service.send(root, "Before removal"); await pump([h.a, h.b, phone], 10);
    await h.a.service.revokeDevice(phone.snapshot.deviceId!);
    await pump([h.a, phone], 2);
    expect(phone.snapshot.enabled).toBe(false);
    await phone.service.enable(); await pump([phone], 2);
    await h.a.service.send(root, "After removal"); await pump([h.a, h.b, phone], 10);
    expect(phone.snapshot.chats[0]?.messages.map(m => m.text)).toEqual(["Before removal"]);
    expect(phone.snapshot.links!.every(l => l.status === "closed")).toBe(true);
  });
  it("closes a mirrored conversation on the linked native browser and its peer", async () => {
    const h = harness(); const root = await h.connect(); const phone = await add(h);
    await h.a.service.send(root, "Preserve this history"); await h.pump();
    await link(h.a, phone);
    await phone.service.close(root); await pump([phone, h.a, h.b], 15);
    for (const browser of [phone, h.a, h.b]) {
      expect(browser.snapshot.chats[0]?.status).toBe("closed");
      expect(browser.snapshot.chats[0]?.messages[0]?.text).toBe("Preserve this history");
    }
    await expect(phone.service.queueMessage(bob.account, "Must not reopen", root)).rejects.toThrow("closed");
  });
  it("recovers a multipart history batch after a crash between encrypted frames", async () => {
    const h = harness(); const root = await h.connect(); const phone = await add(h);
    await link(h.a, phone);
    const service = h.a.service as any;
    const send = service.sendInFile.bind(service);
    let failed = false;
    const crash = vi.spyOn(service, "sendInFile").mockImplementation(async (...args: any[]) => {
      await send(...args);
      if (!failed && args[0].chats.find((c: any) => c.id === args[2])?.kind) {
        failed = true; throw new Error("Browser interrupted after saving a history frame");
      }
    });
    const text = "Long encrypted history 😀 ".repeat(80);
    await h.a.service.send(root, text); await pump([h.a], 2);
    expect(failed).toBe(true); crash.mockRestore(); h.a.reload(); phone.reload();
    await pump([h.a, h.b, phone], 16);
    expect(phone.snapshot.chats[0]?.messages.map(m => m.text)).toEqual([text]);
    expect(phone.snapshot.error).toBe("");
    const before = h.packets.length; await pump([h.a, phone], 8);
    expect(h.packets.length).toBe(before);
  });
  it("converges simultaneous link requests and never auto-approves the winning request", async () => {
    const h = harness(true, false, true); await h.a.service.enable(); await h.pump();
    const phone = await add(h);
    await Promise.all([h.a.service.linkDevice(phone.snapshot.deviceId!), phone.service.linkDevice(h.a.snapshot.deviceId!)]);
    await pump([h.a, phone], 6);
    const a = h.a.snapshot.links!.filter(l => l.status !== "closed"), b = phone.snapshot.links!.filter(l => l.status !== "closed");
    expect(a).toHaveLength(1); expect(b).toHaveLength(1); expect(a[0]!.id).toBe(b[0]!.id);
    expect([a[0]!.status, b[0]!.status].sort()).toEqual(["incoming", "outgoing"]);
    await (a[0]!.status === "incoming" ? h.a : phone).service.accept(a[0]!.id);
    await pump([h.a, phone], 10);
    expect(h.a.snapshot.links!.filter(l => l.status === "ready")).toHaveLength(1);
    expect(phone.snapshot.links!.filter(l => l.status === "ready")).toHaveLength(1);
  });
  it("unlinks without deleting history and refuses future copies until approved again", async () => {
    const h = harness(); const root = await h.connect(); const phone = await add(h);
    await h.a.service.send(root, "Keep the old copy"); await h.pump(); await link(h.a, phone);
    const linkId = phone.snapshot.links!.find(l => l.status === "ready")!.id;
    await phone.service.close(linkId); await pump([phone, h.a], 8);
    expect(h.a.snapshot.links!.find(l => l.id === linkId)!.status).toBe("closed");
    await h.a.service.send(root, "Do not copy this"); await pump([h.a, h.b, phone], 8);
    expect(phone.snapshot.chats[0]?.messages.map(m => m.text)).toEqual(["Keep the old copy"]);
  });

});
