import { describe, expect, it } from "vitest";
import { Signer } from "koilib";
import type { OperationJson, TransactionJson, TransactionReceipt } from "koilib";
import { ProtocolClient, TransactionOutcomeUnknownError, TransactionRevertedError, sponsoredRcLimit } from "./protocolClient.js";
import {
  SponsorClient,
  SponsorError,
  SponsorPool,
  recomputeTransactionId,
  signSponsorDiscovery,
  verifySponsorResult,
  type SponsorResult,
  type UnsignedSponsorDiscovery,
} from "../sponsor.js";
import { encode, toBase64url } from "../encoding.js";
import { coSign, fakeProvider, fakeReceipt, fixtureDeployment, HARBINGER_CHAIN_ID, nonceValue, Transaction } from "../testing/fixtures.js";

const deployment = fixtureDeployment();
const user = Signer.fromSeed("user");
const sponsorSigner = Signer.fromSeed("sponsor");
const attacker = Signer.fromSeed("attacker");

interface FakeSponsorOptions {
  refuse?: { status: number; category?: string; message?: string };
  chainId?: string;
  endpoint?: string;
  maxRcPerOp?: string;
  /** Rewrites what `POST /v1/sponsor` answers (a misbehaving sponsor). */
  respond?: (result: SponsorResult, received: TransactionJson) => unknown;
  /** Rewrites what `POST /v1/prepare` answers (a misbehaving sponsor). */
  prepared?: (transaction: TransactionJson) => unknown;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fake sponsor service: signed discovery, /v1/prepare, co-signs and "broadcasts" on POST /v1/sponsor. */
async function fakeSponsor(options: FakeSponsorOptions = {}) {
  const endpoint = options.endpoint ?? "https://sponsor.test";
  const unsigned: UnsignedSponsorDiscovery = {
    version: 1,
    sponsor: sponsorSigner.getAddress(),
    network: { chainId: options.chainId ?? HARBINGER_CHAIN_ID, rpc: ["https://harbinger-api.koinos.io"] },
    policy: {
      version: 1,
      allowed: [{ contract: deployment.contracts.publications.address, entryPoints: [] }],
      maxBytesPerOp: 6144,
      maxRcPerOp: options.maxRcPerOp ?? "200000000",
      perUser: { dailyOps: 200, burstOps: 20, burstWindowSec: 60 },
    },
  };
  const discovery = await signSponsorDiscovery(unsigned, sponsorSigner);
  const received: TransactionJson[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === `${endpoint}/.well-known/osp-sponsor.json`) return jsonResponse(200, discovery);
    if (url === `${endpoint}/v1/prepare` && init?.method === "POST") {
      const { payee, operations } = JSON.parse(String(init.body)) as { payee: string; operations: OperationJson[] };
      const transaction = await Transaction.prepareTransaction({
        header: { chain_id: unsigned.network.chainId, payer: sponsorSigner.getAddress(), payee, nonce: nonceValue(3), rc_limit: "150000000" },
        operations,
      });
      return jsonResponse(200, { transaction: options.prepared ? options.prepared(transaction) : transaction });
    }
    if (url === `${endpoint}/v1/sponsor` && init?.method === "POST") {
      const { transaction } = JSON.parse(String(init.body)) as { transaction: TransactionJson };
      received.push(transaction);
      if (options.refuse) {
        return jsonResponse(options.refuse.status, {
          error: { category: options.refuse.category, message: options.refuse.message ?? "refused" },
        });
      }
      const coSigned = await coSign(transaction, sponsorSigner);
      const result: SponsorResult = { transaction: coSigned, receipt: fakeReceipt(coSigned, { rc_used: "777" }) };
      return jsonResponse(200, options.respond ? options.respond(result, transaction) : result);
    }
    return jsonResponse(404, { error: { category: "invalid_transaction", message: "not found" } });
  };
  return { client: new SponsorClient({ endpoint, fetch }), received, discovery };
}

/** A receipt carrying a fabricated `osp.publications.published` event. */
function forgedReceipt(tx: TransactionJson, id: string): TransactionReceipt {
  return fakeReceipt(
    { ...tx, id },
    {
      id,
      events: [
        {
          sequence: 0,
          source: deployment.contracts.publications.address,
          name: "osp.publications.published",
          data: toBase64url(
            encode("publications.published_event", {
              author: attacker.getAddress(),
              post_id: new Uint8Array(32).fill(0xaa),
              sequence: "1",
              version_number: 1,
            }),
          ),
          impacted: [attacker.getAddress()],
        },
      ],
    },
  );
}

async function reactOp(client: ProtocolClient): Promise<OperationJson> {
  return client.ops.publications.react({ actor: user.getAddress(), post_id: new Uint8Array(32).fill(1), reaction: 1 });
}

describe("ProtocolClient", () => {
  it("prepares sponsored transactions with payer = sponsor, payee = user and the payee's nonce", async () => {
    const provider = fakeProvider({ nonces: { [user.getAddress()]: 4, [sponsorSigner.getAddress()]: 40 }, rc: { [sponsorSigner.getAddress()]: "900" } });
    const client = new ProtocolClient({ rpc: provider, deployment });
    const op = await reactOp(client);
    expect(op.call_contract?.contract_id).toBe(deployment.contracts.publications.address);
    const tx = await client.prepare([op], { payee: user.getAddress(), payer: sponsorSigner.getAddress() });
    expect(tx.header?.payer).toBe(sponsorSigner.getAddress());
    expect(tx.header?.payee).toBe(user.getAddress());
    expect(tx.header?.chain_id).toBe(HARBINGER_CHAIN_ID);
    // the nonce comes from the payee (user), never from the sponsor
    expect(tx.header?.nonce).toBe(nonceValue(5));
    expect(provider.nonceCalls).toEqual([user.getAddress()]);
    expect(provider.nonceCalls).not.toContain(sponsorSigner.getAddress());
    // prepare() alone keeps koilib semantics: rc_limit from the payer's RC
    expect(tx.header?.rc_limit).toBe("900");
    expect(provider.rcCalls).toEqual([sponsorSigner.getAddress()]);
    expect(tx.id?.startsWith("0x1220")).toBe(true);
    const self = await client.prepare([op], { payee: user.getAddress() });
    expect(self.header?.payer).toBe(user.getAddress());
    expect(self.header?.payee).toBeUndefined();
    expect(self.header?.nonce).toBe(nonceValue(5));
    expect(provider.nonceCalls).toEqual([user.getAddress(), user.getAddress()]);
  });

  it("submits through a sponsor: user + sponsor signatures, policy RC limit, events decoded", async () => {
    const provider = fakeProvider({ rc: { [sponsorSigner.getAddress()]: "999999999999" } });
    const sponsor = await fakeSponsor();
    const client = new ProtocolClient({ rpc: provider, deployment });
    const op = await reactOp(client);
    const result = await client.submit({ operations: [op], signer: user, sponsor: sponsor.client });
    expect(result.sponsored).toBe(true);
    expect(result.sponsor).toBe(sponsorSigner.getAddress());
    expect(result.rcUsed).toBe("777");
    expect(result.refusals).toEqual([]);
    expect(result.transaction.header?.payer).toBe(sponsorSigner.getAddress());
    expect(result.transaction.header?.payee).toBe(user.getAddress());
    // rc_limit = policy.maxRcPerOp * operations, not the sponsor's whole mana (spec 10.2)
    expect(result.transaction.header?.rc_limit).toBe("200000000");
    expect(provider.rcCalls).toEqual([]);
    expect(result.transaction.signatures?.length).toBe(2);
    const signers = await Signer.recoverAddresses(result.transaction);
    expect(signers).toEqual([user.getAddress(), sponsorSigner.getAddress()]);
    // the sponsor received a single user signature and unchanged operations
    expect(sponsor.received[0]?.signatures?.length).toBe(1);
    expect(sponsor.received[0]?.operations).toEqual([op]);
    // nothing was broadcast directly by the client
    expect(provider.sent.length).toBe(0);

    // two operations -> twice the per-operation ceiling; an explicit rcLimit wins
    const two = await client.submit({ operations: [op, op], signer: user, sponsor: sponsor.client });
    expect(two.transaction.header?.rc_limit).toBe("400000000");
    const explicit = await client.submit({ operations: [op], signer: user, sponsor: sponsor.client, rcLimit: "5000" });
    expect(explicit.transaction.header?.rc_limit).toBe("5000");
    expect(sponsoredRcLimit({ policy: { maxRcPerOp: 7 } as never }, 3)).toBe("21");
    expect(sponsoredRcLimit({ policy: { maxRcPerOp: "bogus" } as never }, 3)).toBeUndefined();
    expect(sponsoredRcLimit({ policy: {} as never }, 3)).toBeUndefined();
  });

  it("falls back to the payer's RC when the policy has no usable ceiling", async () => {
    const provider = fakeProvider({ rc: { [sponsorSigner.getAddress()]: "900" } });
    const sponsor = await fakeSponsor({ maxRcPerOp: "0" });
    const client = new ProtocolClient({ rpc: provider, deployment });
    const result = await client.submit({ operations: [await reactOp(client)], signer: user, sponsor: sponsor.client });
    expect(result.transaction.header?.rc_limit).toBe("900");
    expect(provider.rcCalls).toEqual([sponsorSigner.getAddress()]);
  });

  it("falls back to self-pay when the sponsor refuses", async () => {
    const provider = fakeProvider({ rc: { [user.getAddress()]: "12345" } });
    const sponsor = await fakeSponsor({ refuse: { status: 429, category: "quota_exceeded" } });
    const client = new ProtocolClient({ rpc: provider, deployment });
    const op = await client.ops.relationships.follow({ follower: user.getAddress(), target: sponsorSigner.getAddress() });
    const result = await client.submit({ operations: [op], signer: user, sponsor: sponsor.client, waitForReceipt: true });
    expect(result.sponsored).toBe(false);
    expect(result.refusals.length).toBe(1);
    expect(result.refusals[0]?.error).toBeInstanceOf(SponsorError);
    expect(result.refusals[0]?.error.category).toBe("quota_exceeded");
    expect(result.transaction.header?.payer).toBe(user.getAddress());
    expect(result.transaction.header?.payee).toBeUndefined();
    expect(result.transaction.header?.rc_limit).toBe("12345");
    expect(result.transaction.signatures?.length).toBe(1);
    expect(provider.sent.length).toBe(1);
    expect(provider.sent[0]?.broadcast).toBe(true);
    expect(result.block?.blockNumber).toBe(101);
  });

  it("refuses a sponsor that returns a transaction or receipt other than the one the user signed", async () => {
    const forgedId = "0x1220" + "ff".repeat(32);
    const cases: Array<{ label: string; respond: FakeSponsorOptions["respond"]; expect: RegExp }> = [
      {
        label: "substituted transaction id, operations and receipt",
        respond: ({ transaction }) => ({
          transaction: { ...transaction, id: forgedId, operations: [] },
          receipt: forgedReceipt(transaction, forgedId),
        }),
        expect: /id .* != /,
      },
      {
        label: "same id but different operations",
        respond: ({ transaction, receipt }) => ({ transaction: { ...transaction, operations: [] }, receipt }),
        expect: /operations changed/,
      },
      {
        label: "same id but a different payer in the header",
        respond: ({ transaction, receipt }) => ({
          transaction: { ...transaction, header: { ...transaction.header, payer: attacker.getAddress() } },
          receipt,
        }),
        expect: /payer changed/,
      },
      {
        label: "same id and payer but a different rc_limit in the header",
        respond: ({ transaction, receipt }) => ({
          transaction: { ...transaction, header: { ...transaction.header, rc_limit: "1" } },
          receipt,
        }),
        expect: /do not hash to the signed id/,
      },
      {
        label: "user signature dropped",
        respond: ({ transaction, receipt }) => ({
          transaction: { ...transaction, signatures: transaction.signatures?.slice(1) },
          receipt,
        }),
        expect: /signatures were altered or dropped/,
      },
      {
        label: "receipt for another transaction",
        respond: ({ transaction }) => ({ transaction, receipt: forgedReceipt(transaction, forgedId) }),
        expect: /receipt id/,
      },
    ];
    for (const c of cases) {
      const provider = fakeProvider();
      const sponsor = await fakeSponsor({ respond: c.respond });
      const client = new ProtocolClient({ rpc: provider, deployment });
      const op = await reactOp(client);
      await expect(client.submit({ operations: [op], signer: user, sponsor: sponsor.client, selfPayFallback: false }), c.label).rejects.toMatchObject({
        name: "SponsorError",
        category: "invalid_transaction",
        message: c.expect,
      });
      expect(provider.sent.length, c.label).toBe(0);
    }

    // with the default fallback the substitution is recorded as a refusal and the client self-pays
    const provider = fakeProvider();
    const sponsor = await fakeSponsor({ respond: cases[0]?.respond });
    const client = new ProtocolClient({ rpc: provider, deployment });
    const result = await client.submit({ operations: [await reactOp(client)], signer: user, sponsor: sponsor.client });
    expect(result.sponsored).toBe(false);
    expect(result.refusals.map((r) => r.error.category)).toEqual(["invalid_transaction"]);
    expect(result.transaction.id).not.toBe(forgedId);
    expect(result.transaction.operations?.length).toBe(1);
    expect(result.events).toEqual([]);
    expect(provider.sent.length).toBe(1);
  });

  it("verifySponsorResult accepts the honest case", async () => {
    const provider = fakeProvider();
    const client = new ProtocolClient({ rpc: provider, deployment });
    const signed = await client.sign(await client.prepare([await reactOp(client)], { payee: user.getAddress(), payer: sponsorSigner.getAddress() }), user);
    const coSigned = await coSign(signed, sponsorSigner);
    await expect(verifySponsorResult(signed, { transaction: coSigned, receipt: fakeReceipt(coSigned) })).resolves.toBeUndefined();
    expect(await recomputeTransactionId(coSigned)).toBe(signed.id);
    // a header re-serialized with a numeric rc_limit still verifies (same canonical bytes)
    const numeric = { ...coSigned, header: { ...coSigned.header, rc_limit: Number(coSigned.header?.rc_limit) } };
    await expect(verifySponsorResult(signed, { transaction: numeric, receipt: fakeReceipt(coSigned) })).resolves.toBeUndefined();
  });

  it("reports an unknown outcome instead of success when the node times out", async () => {
    const rpcError = { code: -32603, message: "rpc failed, context deadline exceeded" };
    const timeouts = fakeProvider({ onSend: () => ({ rc_used: "", events: [], reverted: false, rpc_error: rpcError }) });
    const client = new ProtocolClient({ rpc: timeouts, deployment });
    const op = await reactOp(client);
    const error = await client.submit({ operations: [op], signer: user, sponsor: null }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionOutcomeUnknownError);
    expect((error as TransactionOutcomeUnknownError).rpcError).toEqual(rpcError);
    expect((error as TransactionOutcomeUnknownError).transaction.id).toBe(timeouts.sent[0]?.transaction.id);
    expect((error as TransactionOutcomeUnknownError).name).toBe("TransactionOutcomeUnknownError");
    // simulate too
    const tx = await client.sign(await client.prepare([op], { payee: user.getAddress() }), user);
    await expect(client.simulate(tx)).rejects.toBeInstanceOf(TransactionOutcomeUnknownError);
    // a sponsor whose node timed out is not a refusal: the transaction may be in flight, never self-pay
    const provider = fakeProvider();
    const sponsor = await fakeSponsor({ respond: ({ transaction, receipt }) => ({ transaction, receipt: { ...receipt, rc_used: "", rpc_error: rpcError } }) });
    const sponsoredClient = new ProtocolClient({ rpc: provider, deployment });
    await expect(sponsoredClient.submit({ operations: [op], signer: user, sponsor: sponsor.client })).rejects.toBeInstanceOf(TransactionOutcomeUnknownError);
    expect(provider.sent.length).toBe(0);
  });

  it("reports reverted transactions as errors", async () => {
    const provider = fakeProvider({ onSend: (_tx, broadcast) => ({ reverted: true, logs: ["transaction reverted: duplicate idempotency key"] }) });
    const client = new ProtocolClient({ rpc: provider, deployment });
    const op = await reactOp(client);
    const error = await client.submit({ operations: [op], signer: user, sponsor: null }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionRevertedError);
    expect((error as TransactionRevertedError).logs).toEqual(["transaction reverted: duplicate idempotency key"]);
    expect((error as TransactionRevertedError).message).toMatch(/duplicate idempotency key/);
    // simulation reports reverts as data rather than throwing
    const tx = await client.sign(await client.prepare([op], { payee: user.getAddress() }), user);
    const sim = await client.simulate(tx);
    expect(sim.reverted).toBe(true);
    expect(sim.logs).toEqual(["transaction reverted: duplicate idempotency key"]);
  });

  it("tries sponsors in order and reports every refusal", async () => {
    const provider = fakeProvider();
    const first = await fakeSponsor({ refuse: { status: 503, category: "temporarily_unavailable" }, endpoint: "https://a.test" });
    const wrongChain = await fakeSponsor({ chainId: "EiB" + "A".repeat(43) + "=", endpoint: "https://b.test" });
    const third = await fakeSponsor({ endpoint: "https://c.test" });
    const client = new ProtocolClient({ rpc: provider, deployment, sponsors: new SponsorPool([first.client, wrongChain.client, third.client]) });
    const op = await reactOp(client);
    const result = await client.submit({ operations: [op], signer: user });
    expect(result.sponsored).toBe(true);
    expect(result.refusals.map((r) => r.error.category)).toEqual(["temporarily_unavailable", "chain_mismatch"]);
    expect(result.transaction.header?.payer).toBe(sponsorSigner.getAddress());
  });

  it("throws the last refusal when self-pay fallback is disabled", async () => {
    const provider = fakeProvider();
    const sponsor = await fakeSponsor({ refuse: { status: 403, category: "method_not_allowed" } });
    const client = new ProtocolClient({ rpc: provider, deployment });
    const op = await reactOp(client);
    await expect(client.submit({ operations: [op], signer: user, sponsor: sponsor.client, selfPayFallback: false })).rejects.toMatchObject({
      category: "method_not_allowed",
    });
    expect(provider.sent.length).toBe(0);
  });

  it("simulates without broadcasting and reads contracts", async () => {
    const provider = fakeProvider({
      onSend: () => ({ rc_used: "4242" }),
      onRead: (op) =>
        op.entry_point === (client.contracts.method("publications", "get_author_state").entry_point)
          ? encode("publications.get_author_state_result", { value: { next_sequence: "9", post_count: "8" } })
          : undefined,
    });
    const client = new ProtocolClient({ rpc: provider, deployment });
    const op = await reactOp(client);
    const tx = await client.sign(await client.prepare([op], { payee: user.getAddress() }), user);
    const sim = await client.simulate(tx);
    expect(sim.rcUsed).toBe("4242");
    expect(sim.reverted).toBe(false);
    expect(provider.sent[0]?.broadcast).toBe(false);
    const state = await client.reads.publications.get_author_state({ author: user.getAddress() });
    expect(state?.value?.next_sequence).toBe("9");
    expect(state?.value?.last_publish_at).toBe("0");
    const missing = await client.reads.identity.get_identity({ account: user.getAddress() });
    expect(missing).toBeUndefined();
    const generic = await client.read("publications", "get_author_state", { author: user.getAddress() });
    expect(generic?.value?.post_count).toBe("8");
    expect((await client.verifyChainId()).ok).toBe(true);
    expect(client.chainIdBytes.length).toBe(34);
    const decoded = client.contracts.decodeOperation(op);
    expect(decoded?.method).toBe("react");
    expect(decoded?.args.actor).toBe(user.getAddress());
  });
});

describe("SponsorClient", () => {
  it("verifies discovery signatures", async () => {
    const sponsor = await fakeSponsor();
    const doc = await sponsor.client.discover();
    expect(doc.sponsor).toBe(sponsorSigner.getAddress());
    expect(sponsor.client.address).toBe(sponsorSigner.getAddress());
    // tampered document
    const forged = { ...sponsor.discovery, policy: { ...sponsor.discovery.policy, maxRcPerOp: "1" } };
    const client = new SponsorClient({ endpoint: "https://forged.test", fetch: async () => jsonResponse(200, forged) });
    await expect(client.discover()).rejects.toMatchObject({ category: "invalid_signature" });
    // signed by a different key than `sponsor`
    const other = await signSponsorDiscovery({ ...sponsor.discovery, sponsor: user.getAddress() }, sponsorSigner);
    const client2 = new SponsorClient({ endpoint: "https://other.test", fetch: async () => jsonResponse(200, other) });
    await expect(client2.discover()).rejects.toMatchObject({ category: "invalid_signature" });
    // expected chain enforcement
    const client3 = new SponsorClient({ endpoint: "https://chain.test", fetch: async () => jsonResponse(200, sponsor.discovery), expectedChainId: "other" });
    await expect(client3.discover()).rejects.toMatchObject({ category: "chain_mismatch" });
  });

  it("maps HTTP failures to refusal categories", async () => {
    const client = new SponsorClient({ endpoint: "https://down.test/", fetch: async () => { throw new Error("ECONNREFUSED"); } });
    await expect(client.sponsor({})).rejects.toMatchObject({ category: "temporarily_unavailable" });
    const client2 = new SponsorClient({ endpoint: "https://big.test", fetch: async () => new Response("too big", { status: 413 }) });
    await expect(client2.sponsor({})).rejects.toMatchObject({ category: "too_large", status: 413 });
    expect(toBase64url(new Uint8Array([1]))).toBe("AQ==");
  });

  it("prepare() hands back only a verified transaction", async () => {
    const provider = fakeProvider();
    const protocol = new ProtocolClient({ rpc: provider, deployment });
    const op = await reactOp(protocol);
    const honest = await fakeSponsor();
    const tx = await honest.client.prepare(user.getAddress(), [op]);
    expect(tx.header?.payer).toBe(sponsorSigner.getAddress());
    expect(tx.header?.payee).toBe(user.getAddress());
    expect(tx.header?.chain_id).toBe(HARBINGER_CHAIN_ID);
    expect(tx.operations).toEqual([op]);
    expect(tx.id).toBe(await recomputeTransactionId(tx));
    // it is signable and sponsorable as-is
    const signed = await protocol.sign(tx, user);
    const result = await honest.client.sponsor(signed);
    expect(result.transaction.signatures?.length).toBe(2);

    const bad: Array<{ label: string; prepared: FakeSponsorOptions["prepared"]; category: string; message: RegExp }> = [
      {
        label: "swapped operations",
        prepared: (t) => ({
          ...t,
          operations: [{ call_contract: { contract_id: deployment.contracts.identity.address, entry_point: 1, args: "AQ==" } }],
        }),
        category: "invalid_transaction",
        message: /operations differ/,
      },
      {
        label: "payee is someone else",
        prepared: (t) => ({ ...t, header: { ...t.header, payee: attacker.getAddress() } }),
        category: "invalid_transaction",
        message: /payee/,
      },
      {
        label: "payer is not the sponsor",
        prepared: (t) => ({ ...t, header: { ...t.header, payer: attacker.getAddress() } }),
        category: "invalid_transaction",
        message: /payer/,
      },
      {
        label: "id does not match the header",
        prepared: (t) => ({ ...t, id: "0x1220" + "ee".repeat(32) }),
        category: "invalid_transaction",
        message: /id does not match/,
      },
      {
        label: "wrong chain",
        prepared: (t) => ({ ...t, header: { ...t.header, chain_id: "EiB" + "A".repeat(43) + "=" } }),
        category: "chain_mismatch",
        message: /chain/,
      },
      {
        label: "incomplete header",
        prepared: (t) => ({ ...t, header: { ...t.header, nonce: undefined } }),
        category: "invalid_transaction",
        message: /incomplete/,
      },
      {
        label: "already signed",
        prepared: (t) => ({ ...t, signatures: ["AA=="] }),
        category: "invalid_transaction",
        message: /unsigned/,
      },
    ];
    for (const c of bad) {
      const sponsor = await fakeSponsor({ prepared: c.prepared });
      await expect(sponsor.client.prepare(user.getAddress(), [op]), c.label).rejects.toMatchObject({ category: c.category, message: c.message });
    }
    // a missing id is filled in from the recomputation
    const noId = await fakeSponsor({ prepared: ({ id: _id, ...rest }) => rest });
    expect((await noId.client.prepare(user.getAddress(), [op])).id).toBe(tx.id);
  });
});
