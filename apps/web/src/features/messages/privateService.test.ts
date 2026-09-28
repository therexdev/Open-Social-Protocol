import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  contentHash,
  fromBase64url,
  identityFromSeed,
  toBase64url,
  type Identity,
  type PrivateDevice,
  type ProtocolClient,
} from "@osp/sdk";
import type { IndexerClient, PrivatePacketView } from "../../api/indexer";
import { memoryStorage } from "../../vault/storage";
import { PrivateStore, type ExclusiveLock } from "./privateStore";
import {
  PrivateMessagingService,
  type PrivateSnapshot,
} from "./privateService";

vi.mock("../../tx/submit", () => ({
  submitAction: async (ctx: any, ops: any[]) =>
    ctx.client.submit({ operations: ops, signer: ctx.signer }),
}));
beforeAll(() =>
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  }),
);
const alice = identityFromSeed(new Uint8Array(32).fill(81), 1),
  bob = identityFromSeed(new Uint8Array(32).fill(82), 1);
const scope = { chainId: "test", contract: "messaging" };
const locks = new Map<string, Promise<unknown>>();
const lock: ExclusiveLock = async (name, action) => {
  const p = (locks.get(name) ?? Promise.resolve()).catch(() => {}).then(action);
  locks.set(name, p);
  return p;
};
function harness() {
  const devices = new Map<string, PrivateDevice[]>(),
    channels = new Map<string, any>(),
    packets: PrivatePacketView[] = [],
    operations: any[] = [];
  const pair = (a: string, b: string) => [a, b].sort().join(":");
  let unknown = false,
    lib = "1000";
  const reads = {
    get_private_status: async () => ({
      version: 2,
      sequence: String(packets.length),
    }),
    get_private_devices: async ({ account }: any) => ({
      values: devices.get(account) ?? [],
    }),
    get_private_units: async () => ({ units: "100" }),
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
    deployment: {
      chainId: scope.chainId,
      contracts: { messaging: { address: scope.contract } },
    },
    provider: { getHeadInfo: async () => ({ last_irreversible_block: lib }) },
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
    submit: async ({ operations: ops, signer }: any) => {
      for (const op of ops) {
        const a = op.args;
        operations.push({ ...op, signer: signer.getAddress() });
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
      return {};
    },
  } as unknown as ProtocolClient;
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
        [],
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
    setUnknown: () => {
      unknown = true;
    },
    setLib: (n: string) => {
      lib = n;
    },
  };
}

describe("two-browser private conversations", () => {
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
