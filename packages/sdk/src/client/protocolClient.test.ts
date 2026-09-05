import { describe, expect, it } from "vitest";
import { Signer } from "koilib";
import type { TransactionJson } from "koilib";
import { ProtocolClient } from "./protocolClient.js";
import { SponsorClient, SponsorError, SponsorPool, signSponsorDiscovery, type UnsignedSponsorDiscovery } from "../sponsor.js";
import { encode, toBase64url } from "../encoding.js";
import { coSign, fakeProvider, fakeReceipt, fixtureDeployment, HARBINGER_CHAIN_ID } from "../testing/fixtures.js";

const deployment = fixtureDeployment();
const user = Signer.fromSeed("user");
const sponsorSigner = Signer.fromSeed("sponsor");

interface FakeSponsorOptions {
  refuse?: { status: number; category?: string; message?: string };
  chainId?: string;
  endpoint?: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fake sponsor service: signed discovery, co-signs and "broadcasts" on POST /v1/sponsor. */
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
      maxRcPerOp: "200000000",
      perUser: { dailyOps: 200, burstOps: 20, burstWindowSec: 60 },
    },
  };
  const discovery = await signSponsorDiscovery(unsigned, sponsorSigner);
  const received: TransactionJson[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === `${endpoint}/.well-known/osp-sponsor.json`) return jsonResponse(200, discovery);
    if (url === `${endpoint}/v1/sponsor` && init?.method === "POST") {
      const { transaction } = JSON.parse(String(init.body)) as { transaction: TransactionJson };
      received.push(transaction);
      if (options.refuse) {
        return jsonResponse(options.refuse.status, {
          error: { category: options.refuse.category, message: options.refuse.message ?? "refused" },
        });
      }
      const coSigned = await coSign(transaction, sponsorSigner);
      return jsonResponse(200, { transaction: coSigned, receipt: fakeReceipt(coSigned, { rc_used: "777" }) });
    }
    return jsonResponse(404, { error: { category: "invalid_transaction", message: "not found" } });
  };
  return { client: new SponsorClient({ endpoint, fetch }), received, discovery };
}

describe("ProtocolClient", () => {
  it("prepares sponsored transactions with payer = sponsor and payee = user", async () => {
    const provider = fakeProvider({ nonces: { [user.getAddress()]: 4 }, rc: { [sponsorSigner.getAddress()]: "900" } });
    const client = new ProtocolClient({ rpc: provider, deployment });
    const op = await client.ops.publications.react({ actor: user.getAddress(), post_id: new Uint8Array(32).fill(1), reaction: 1 });
    expect(op.call_contract?.contract_id).toBe(deployment.contracts.publications.address);
    const tx = await client.prepare([op], { payee: user.getAddress(), payer: sponsorSigner.getAddress() });
    expect(tx.header?.payer).toBe(sponsorSigner.getAddress());
    expect(tx.header?.payee).toBe(user.getAddress());
    expect(tx.header?.chain_id).toBe(HARBINGER_CHAIN_ID);
    expect(tx.header?.rc_limit).toBe("900");
    expect(tx.header?.nonce).toBeDefined();
    expect(tx.id?.startsWith("0x1220")).toBe(true);
    const self = await client.prepare([op], { payee: user.getAddress() });
    expect(self.header?.payer).toBe(user.getAddress());
    expect(self.header?.payee).toBeUndefined();
  });

  it("submits through a sponsor: user + sponsor signatures, events decoded", async () => {
    const provider = fakeProvider();
    const sponsor = await fakeSponsor();
    const client = new ProtocolClient({ rpc: provider, deployment });
    const op = await client.ops.publications.react({ actor: user.getAddress(), post_id: new Uint8Array(32).fill(1), reaction: 1 });
    const result = await client.submit({ operations: [op], signer: user, sponsor: sponsor.client });
    expect(result.sponsored).toBe(true);
    expect(result.sponsor).toBe(sponsorSigner.getAddress());
    expect(result.rcUsed).toBe("777");
    expect(result.refusals).toEqual([]);
    expect(result.transaction.header?.payer).toBe(sponsorSigner.getAddress());
    expect(result.transaction.header?.payee).toBe(user.getAddress());
    expect(result.transaction.signatures?.length).toBe(2);
    const signers = await Signer.recoverAddresses(result.transaction);
    expect(signers).toEqual([user.getAddress(), sponsorSigner.getAddress()]);
    // the sponsor received a single user signature and unchanged operations
    expect(sponsor.received[0]?.signatures?.length).toBe(1);
    expect(sponsor.received[0]?.operations).toEqual([op]);
    // nothing was broadcast directly by the client
    expect(provider.sent.length).toBe(0);
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

  it("tries sponsors in order and reports every refusal", async () => {
    const provider = fakeProvider();
    const first = await fakeSponsor({ refuse: { status: 503, category: "temporarily_unavailable" }, endpoint: "https://a.test" });
    const wrongChain = await fakeSponsor({ chainId: "EiB" + "A".repeat(43) + "=", endpoint: "https://b.test" });
    const third = await fakeSponsor({ endpoint: "https://c.test" });
    const client = new ProtocolClient({ rpc: provider, deployment, sponsors: new SponsorPool([first.client, wrongChain.client, third.client]) });
    const op = await client.ops.publications.react({ actor: user.getAddress(), post_id: new Uint8Array(32).fill(1), reaction: 1 });
    const result = await client.submit({ operations: [op], signer: user });
    expect(result.sponsored).toBe(true);
    expect(result.refusals.map((r) => r.error.category)).toEqual(["temporarily_unavailable", "chain_mismatch"]);
    expect(result.transaction.header?.payer).toBe(sponsorSigner.getAddress());
  });

  it("throws the last refusal when self-pay fallback is disabled", async () => {
    const provider = fakeProvider();
    const sponsor = await fakeSponsor({ refuse: { status: 403, category: "method_not_allowed" } });
    const client = new ProtocolClient({ rpc: provider, deployment });
    const op = await client.ops.publications.react({ actor: user.getAddress(), post_id: new Uint8Array(32).fill(1), reaction: 1 });
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
    const op = await client.ops.publications.react({ actor: user.getAddress(), post_id: new Uint8Array(32).fill(1), reaction: 1 });
    const tx = await client.sign(await client.prepare([op], { payee: user.getAddress() }), user);
    const sim = await client.simulate(tx);
    expect(sim.rcUsed).toBe("4242");
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
    const client3 = new SponsorClient({ endpoint: "https://prep.test", fetch: async () => jsonResponse(200, { transaction: { header: { payer: "1x" }, operations: [] } }) });
    expect((await client3.prepare("1user", [])).header?.payer).toBe("1x");
    expect(toBase64url(new Uint8Array([1]))).toBe("AQ==");
  });
});
