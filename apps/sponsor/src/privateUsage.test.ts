import { describe, expect, it } from "vitest";
import { ABIS } from "@osp/proto";
import {
  ProtocolClient,
  Signer,
  encode,
  decode,
  fromBase64url,
  randomBytes,
  signPrivateStatement,
  toBase64url,
} from "@osp/sdk";
import { createServer } from "./server.js";
import {
  fakeProvider,
  fixtureDeployment,
  testConfig,
  nonceValue,
} from "./__tests__/helpers.js";
const deployment = fixtureDeployment(),
  signer = Signer.fromSeed("private-payer"),
  owner = Signer.fromSeed("private-owner"),
  other = Signer.fromSeed("private-other"),
  alias = Signer.fromSeed("private-alias").getAddress();
const scope = {
  chainId: deployment.chainId,
  contract: deployment.contracts.messaging.address,
};
async function start(fast = false, allocationResponseWaitMs = 1500) {
  const reservationId = toBase64url(randomBytes(32));
  const grants = new Map<string, any>();
  let lib = "100", height = "100";
  const provider = fakeProvider({
    onRead(op) {
      if (op.contract_id === deployment.contracts.identity.address)
        return encode("identity.get_identity_result", {
          value: { account: owner.getAddress(), owner: owner.getAddress() },
        });
      if (
        op.entry_point ===
        ABIS.messaging.methods.get_private_reservation!.entry_point
      )
        return encode("messaging.get_private_reservation_result", {
          value: {
            account: owner.getAddress(),
            sponsor: signer.getAddress(),
            reservation_id: decode(ABIS.messaging.methods.get_private_reservation!.argument, op.args).reservation_id,
            units: 4,
            block: "50",
          },
        });
      if (
        op.entry_point === ABIS.messaging.methods.get_private_grant!.entry_point
      ) {
        const requested = decode(ABIS.messaging.methods.get_private_grant!.argument, op.args).grant_id as Uint8Array;
        const granted = grants.get(toBase64url(requested));
        return encode(
          "messaging.get_private_grant_result",
          granted ? { value: granted } : {},
        );
      }
      return undefined;
    },
  });
  provider.getHeadInfo = async () => ({
    head_block_time: "1",
    head_topology: { height, id: "id", previous: "previous" },
    head_state_merkle_root: "",
    last_irreversible_block: lib,
  });
  const app = await createServer({
    allocationResponseWaitMs,
    config: testConfig({ allowlist: "messaging:allocate_private_usage" }),
    deployment: { ...deployment, network: fast ? "harbinger" : deployment.network },
    signer,
    provider,
  });
  const request = async (actor = alias, proofSigner = owner, requestedId = reservationId) => ({
    reservationId: requestedId,
    actor,
    signature: await signPrivateStatement(
      scope,
      "allocate",
      { reservationId: requestedId, actor },
      proofSigner,
    ),
  });
  return {
    app,
    provider,
    request,
    reservationId,
    setHead: (value: string) => { height = value; },
    setGranted: (v: any) => {
      grants.set(toBase64url(v.grant_id), v);
    },
    setLib: (v: string) => {
      lib = v;
    },
  };
}
describe("private allowance assignments", () => {
  it("acknowledges queued grants promptly, coalesces retries, and preserves payer nonce order", async () => {
    const h = await start(true, 10);
    let release!: () => void, finished!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const completed = new Promise<void>(resolve => { finished = resolve; });
    let nonce = 0, inFlight = false;
    const client = new ProtocolClient({ deployment, rpc: h.provider });
    const send = h.provider.sendTransaction;
    h.provider.getNextNonce = async () => nonceValue(nonce + 1);
    h.provider.sendTransaction = async (tx, broadcast) => {
      if (inFlight || tx.header?.nonce !== nonceValue(nonce + 1)) throw new Error("invalid account nonce");
      inFlight = true;
      const result = await send(tx, broadcast);
      return { ...result, transaction: { ...result.transaction, wait: async () => {
        if (nonce === 0) await blocked;
        nonce++; inFlight = false;
        h.setGranted(client.contracts.decodeOperation(tx.operations![0]!)!.args);
        if (nonce === 2) finished();
        return { blockId: `block-${nonce}`, blockNumber: 100 + nonce };
      } } };
    };
    try {
      const payload = await h.request();
      const first = await h.app.inject({ method: "POST", url: "/v2/private/allocate", payload });
      expect(first.statusCode).toBe(200); expect(first.json().pending).toBe(true);
      // The receipt remains blocked, but neither the original HTTP request nor
      // another person's request must wait for it (or hit a browser timeout).
      const retry = await h.app.inject({ method: "POST", url: "/v2/private/allocate", payload });
      expect(retry.json()).toEqual(first.json());
      const forged = await h.app.inject({ method: "POST", url: "/v2/private/allocate", payload: await h.request(alias, other) });
      expect(forged.statusCode).toBe(400);
      const secondPayload = await h.request(other.getAddress(), owner, toBase64url(randomBytes(32)));
      const second = await h.app.inject({ method: "POST", url: "/v2/private/allocate", payload: secondPayload });
      expect(second.json().pending).toBe(true);
      expect(second.json().grantId).not.toBe(first.json().grantId);
      expect(h.provider.sent).toHaveLength(1);
      release(); await completed;
      const done = await h.app.inject({ method: "POST", url: "/v2/private/allocate", payload });
      expect(done.json()).toEqual({ grantId: first.json().grantId, pending: false });
      expect(h.provider.sent.map(p => p.transaction.header?.nonce)).toEqual([nonceValue(1), nonceValue(2)]);
    } finally { release(); await h.app.close(); }
  });
  it("advertises three testnet confirmations and enforces that boundary", async () => {
    const h = await start(true);
    try {
      h.setLib("1"); h.setHead("51");
      const pending = await h.app.inject({ method: "POST", url: "/v2/private/allocate", payload: await h.request() });
      expect(pending.statusCode).toBe(503);
      expect(h.provider.sent).toHaveLength(0);
      h.setHead("52");
      const accepted = await h.app.inject({ method: "POST", url: "/v2/private/allocate", payload: await h.request() });
      expect(accepted.statusCode).toBe(200);
      expect(h.provider.sent).toHaveLength(1);
      const health = await h.app.inject({ method: "GET", url: "/healthz" });
      expect(health.json().features.messagingFastConfirmation).toBe(1);
      const discovery = await h.app.inject({ method: "GET", url: "/.well-known/osp-sponsor.json" });
      expect(discovery.json().policy.privateUsageConfirmations).toBe(3);
    } finally { await h.app.close(); }
  });
  it("holds the payer queue through inclusion before granting the next reservation", async () => {
    const h = await start();
    let release!: () => void;
    const block = new Promise<void>(resolve => { release = resolve; });
    let broadcast!: () => void;
    const broadcasted = new Promise<void>(resolve => { broadcast = resolve; });
    let nonce = 0, inFlight = false;
    h.provider.getNextNonce = async () => nonceValue(nonce + 1);
    const send = h.provider.sendTransaction;
    const client = new ProtocolClient({ deployment, rpc: h.provider });
    h.provider.sendTransaction = async (tx, shouldBroadcast) => {
      if (inFlight || tx.header?.nonce !== nonceValue(nonce + 1)) throw new Error("invalid account nonce");
      inFlight = true;
      const result = await send(tx, shouldBroadcast);
      broadcast();
      const first = nonce === 0;
      return { ...result, transaction: { ...result.transaction, wait: async () => {
        if (first) await block;
        nonce++; inFlight = false;
        const op = client.contracts.decodeOperation(tx.operations![0]!)!;
        h.setGranted(op.args);
        return { blockId: `block-${nonce}`, blockNumber: 100 + nonce };
      } } };
    };
    try {
      let finished = false;
      const first = h.app.inject({ method: "POST", url: "/v2/private/allocate", payload: await h.request() }).then(r => { finished = true; return r; });
      await broadcasted;
      const second = h.app.inject({ method: "POST", url: "/v2/private/allocate", payload: await h.request(other.getAddress(), owner, toBase64url(randomBytes(32))) });
      // Let both HTTP handlers run while the first transaction is still unmined.
      const both = Promise.all([first, second]);
      await new Promise(resolve => setImmediate(resolve));
      expect(finished).toBe(false);
      expect(h.provider.sent).toHaveLength(1);
      release();
      const responses = await both;
      expect(responses.map(r => r.statusCode)).toEqual([200, 200]);
      expect(h.provider.sent.map(r => r.transaction.header?.nonce)).toEqual([nonceValue(1), nonceValue(2)]);
    } finally { release(); await h.app.close(); }
  });
  it("requires owner proof and finality before allocating a prepaid reservation", async () => {
    const h = await start();
    try {
      const stolen = await h.app.inject({
        method: "POST",
        url: "/v2/private/allocate",
        payload: await h.request(alias, other),
      });
      expect(stolen.statusCode).toBe(400);
      expect(h.provider.sent).toHaveLength(0);
      h.setLib("49");
      const pending = await h.app.inject({
        method: "POST",
        url: "/v2/private/allocate",
        payload: await h.request(),
      });
      expect(pending.statusCode).toBe(503);
      expect(h.provider.sent).toHaveLength(0);
      h.setLib("100");
      const good = await h.app.inject({
        method: "POST",
        url: "/v2/private/allocate",
        payload: await h.request(),
      });
      expect(good.statusCode).toBe(200);
      const grantId = good.json().grantId;
      expect(grantId).not.toBe(h.reservationId);
      const client = new ProtocolClient({ deployment, rpc: h.provider }),
        op = client.contracts.decodeOperation(
          h.provider.sent[0]!.transaction.operations![0]!,
        )!;
      expect(op.method).toBe("allocate_private_usage");
      expect(op.args.actor).toBe(alias);
      expect(JSON.stringify(op.args)).not.toContain(owner.getAddress());
      expect(toBase64url(op.args.grant_id as Uint8Array)).toBe(grantId);
      h.setGranted({
        sponsor: signer.getAddress(),
        actor: alias,
        grant_id: fromBase64url(grantId),
        units: 4,
      });
      const retry = await h.app.inject({
        method: "POST",
        url: "/v2/private/allocate",
        payload: await h.request(),
      });
      expect(retry.json()).toEqual({ grantId, pending: false });
      expect(h.provider.sent).toHaveLength(1);
      const rebound = await h.app.inject({
        method: "POST",
        url: "/v2/private/allocate",
        payload: await h.request(other.getAddress()),
      });
      expect(rebound.statusCode).toBe(400);
    } finally {
      await h.app.close();
    }
  });
  it("never sponsors a caller-supplied allocation, even with an explicit allowlist entry", async () => {
    const h = await start();
    try {
      const client = new ProtocolClient({ deployment, rpc: h.provider });
      const operation = await client.ops.messaging.allocate_private_usage({
        sponsor: signer.getAddress(),
        actor: alias,
        grant_id: randomBytes(32),
        units: 20,
      });
      const result = await h.app.inject({
        method: "POST",
        url: "/v1/prepare",
        payload: { payee: alias, operations: [operation] },
      });
      expect(result.statusCode).toBe(403);
      expect(h.provider.sent).toHaveLength(0);
    } finally {
      await h.app.close();
    }
  });
});
