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
async function start() {
  const reservationId = toBase64url(randomBytes(32));
  const grants = new Map<string, any>();
  let lib = "100";
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
    head_topology: { height: "100", id: "id", previous: "previous" },
    head_state_merkle_root: "",
    last_irreversible_block: lib,
  });
  const app = await createServer({
    config: testConfig({ allowlist: "messaging:allocate_private_usage" }),
    deployment,
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
    setGranted: (v: any) => {
      grants.set(toBase64url(v.grant_id), v);
    },
    setLib: (v: string) => {
      lib = v;
    },
  };
}
describe("private allowance assignments", () => {
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
