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
function harness(prepaid = true, fast = false) {
  let delayedNonce = false;
  const pendingNonces = new Set<string>();
  const devices = new Map<string, PrivateDevice[]>(),
    channels = new Map<string, any>(),
    packets: PrivatePacketView[] = [],
    operations: any[] = [],
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
      for (const op of ops) {
        const a = op.args;
        operations.push({ ...op, signer: signer.getAddress() });
        if (op.method === "reserve_private_usage") {
          const key = toBase64url(a.reservation_id);
          if (!reservations.has(key)) reservations.set(key, { ...a, block: "5" });
        }
        if (op.method === "set_private_device")
          devices.set(a.account, [
            {
              device_id: a.device_id,
              delivery_key: a.delivery_key,
              label: a.label,
              updated_at: String(Date.now()),
            },
          ]);
        if (op.method === "open_private_channel") {
          const key = pair(a.actor, a.peer),
            old = channels.get(key);
          channels.set(
            key,
            old
              ? { ...old, status: old.requester === a.actor ? 1 : 2 }
              : { a: a.actor, b: a.peer, requester: a.actor, status: 1 },
          );
        }
        if (op.method === "close_private_channel") {
          const key = pair(a.actor, a.peer);
          channels.set(key, { ...channels.get(key), status: 3, block: "5" });
        }
        if (op.method === "post_private_packet") {
          if (
            !packets.some(
              (p) =>
                p.actor === a.actor && p.packet_id === toBase64url(a.packet_id),
            )
          )
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
    packets,
    operations,
    pump,
    connect,
    reservations,
    delayNonceUntilInclusion: () => { delayedNonce = true; },
    allocate: (reservationId: string, actor: string, signature: string) => {
      const reservation = reservations.get(reservationId);
      expect(reservation).toBeDefined();
      expect(verifyPrivateStatement(scope, "allocate", { reservationId, actor }, signature, reservation.account)).toBe(true);
      units.set(actor, reservation.units);
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
  it("connects after three testnet confirmations and pipelines messages before finality", async () => {
    const h = harness(true, true);
    h.setLib("1"); h.setHead("6");
    await h.a.service.enable(); await h.b.service.enable(); await h.pump();
    const chat = await h.a.service.start(bob.account);
    await h.pump();
    expect(h.b.snapshot.chats).toHaveLength(0);
    h.setHead("7"); await h.pump();
    expect(h.b.snapshot.chats[0]?.status).toBe("incoming");
    await h.b.service.accept(chat); await h.pump(8);
    expect(h.a.snapshot.chats[0]?.status).toBe("ready");
    expect(h.b.snapshot.chats[0]?.status).toBe("ready");
    await h.a.service.send(chat, "first");
    await h.a.service.send(chat, "second");
    await h.pump();
    expect(h.b.snapshot.chats[0]?.messages.map(m => m.text)).toEqual(["first", "second"]);
    expect(h.b.snapshot.chats[0]?.messages.every(m => m.state === "confirming")).toBe(true);
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
  it("accepts with two allowance reservations without reusing an unmined account nonce", async () => {
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
    expect(reservations.map(op => op.args.units)).toEqual([4, 1]);
    expect(new Set(reservations.map(op => toBase64url(op.args.reservation_id))).size).toBe(2);
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
});
