import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ProtocolClient,
  Signer,
  SponsorClient,
  Transaction,
  TransactionOutcomeUnknownError,
  encode,
  signSponsorDiscovery,
  verifySponsorDiscovery,
  verifySponsorResult,
  type Deployment,
  type OperationJson,
  type SponsorDiscovery,
  type SponsorResult,
  type TransactionJson,
} from "@osp/sdk";
import { ABIS } from "@osp/proto";
import { createServer } from "./server.js";
import type { SponsorConfig } from "./config.js";
import { fakeProvider, fixtureDeployment, HARBINGER_CHAIN_ID, injectFetch, nonceValue, testConfig, type FakeProvider, type FakeProviderOptions } from "./__tests__/helpers.js";

const deployment = fixtureDeployment();
const sponsorSigner = Signer.fromSeed("osp-sponsor-test-payer");
const sponsor = sponsorSigner.getAddress();
const user = Signer.fromSeed("osp-sponsor-test-user");
const other = Signer.fromSeed("osp-sponsor-test-other");

interface StartOptions {
  config?: Partial<SponsorConfig>;
  provider?: FakeProviderOptions;
  now?: () => number;
  deployment?: Deployment | null;
  signer?: Signer | null;
}

interface Harness {
  app: FastifyInstance;
  provider: FakeProvider;
  client: ProtocolClient;
}

async function start(options: StartOptions = {}): Promise<Harness> {
  const provider = fakeProvider({ rc: { [sponsor]: "1000000000" }, ...options.provider });
  const app = await createServer({
    config: testConfig(options.config),
    deployment: options.deployment === null ? undefined : (options.deployment ?? deployment),
    signer: options.signer === null ? undefined : (options.signer ?? sponsorSigner),
    provider,
    now: options.now,
  });
  const client = new ProtocolClient({ rpc: provider, deployment });
  return { app, provider, client };
}

const postId = new Uint8Array(32).fill(7);

function reactOp(client: ProtocolClient, actor = user.getAddress(), device?: string): Promise<OperationJson> {
  return client.ops.publications.react({ actor, post_id: postId, reaction: 1, ...(device && { device }) });
}

function followOp(client: ProtocolClient, follower = user.getAddress()): Promise<OperationJson> {
  return client.ops.relationships.follow({ follower, target: other.getAddress() });
}

interface TxOptions {
  signer?: Signer;
  payee?: string;
  payer?: string;
  rcLimit?: string;
  chainId?: string;
  sign?: boolean;
  /** Explicit payee nonce (`nonceValue(n)`), so several transactions can be pre-signed. */
  nonce?: string;
}

/** A payee-signed sponsored transaction the way the SDK builds it. */
async function userTx(harness: Harness, operations: OperationJson[], options: TxOptions = {}): Promise<TransactionJson> {
  const client = options.chainId ? new ProtocolClient({ rpc: harness.provider, deployment, chainId: options.chainId }) : harness.client;
  const signer = options.signer ?? user;
  const payee = options.payee ?? signer.getAddress();
  const prepared = await client.prepare(operations, {
    payee,
    payer: options.payer ?? sponsor,
    rcLimit: options.rcLimit ?? "100000000",
    ...(options.nonce !== undefined && { nonce: options.nonce }),
  });
  return options.sign === false ? prepared : client.sign(prepared, signer);
}

function deviceOp(client: ProtocolClient, method: "authorize_device" | "revoke_device", account: string, device: string): Promise<OperationJson> {
  return method === "authorize_device"
    ? client.ops.identity.authorize_device({ account, device, capabilities: 1, expires_at: "9999999999999", label: "phone" })
    : client.ops.identity.revoke_device({ account, device });
}

async function sponsorRequest(app: FastifyInstance, transaction: unknown) {
  const response = await app.inject({ method: "POST", url: "/v1/sponsor", payload: { transaction } });
  return { status: response.statusCode, body: response.json() as Record<string, any>, headers: response.headers };
}

async function expectRefusal(app: FastifyInstance, transaction: unknown, status: number, category: string, messagePattern?: RegExp) {
  const result = await sponsorRequest(app, transaction);
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  expect(result.body.error?.category).toBe(category);
  if (messagePattern) expect(result.body.error?.message).toMatch(messagePattern);
  return result;
}

describe("discovery", () => {
  it("serves a signed document that verifies and describes the default policy", async () => {
    const { app } = await start();
    const first = await app.inject({ method: "GET", url: "/.well-known/osp-sponsor.json" });
    expect(first.statusCode).toBe(200);
    expect(first.headers["access-control-allow-origin"]).toBe("*");
    const doc = first.json() as SponsorDiscovery;
    expect(verifySponsorDiscovery(doc)).toEqual({ valid: true, signer: sponsor });
    expect(doc.version).toBe(1);
    expect(doc.sponsor).toBe(sponsor);
    expect(doc.network.chainId).toBe(HARBINGER_CHAIN_ID);
    expect(doc.network.rpc).toEqual(deployment.rpc);
    expect(doc.policy.version).toBe(1);
    expect(doc.policy.maxBytesPerOp).toBe(6144);
    expect(doc.policy.maxRcPerOp).toBe("200000000");
    expect(doc.policy.perUser).toEqual({ dailyOps: 200, burstOps: 20, burstWindowSec: 60 });
    const contracts = doc.policy.allowed.map((a) => a.contract).sort();
    expect(contracts).toEqual(
      [deployment.contracts.identity, deployment.contracts.relationships, deployment.contracts.publications, deployment.contracts.communities]
        .map((c) => c.address)
        .sort(),
    );
    const publications = doc.policy.allowed.find((a) => a.contract === deployment.contracts.publications.address);
    expect(publications?.entryPoints).toContain(ABIS.publications.methods.publish?.entry_point);
    expect(publications?.entryPoints).not.toContain(ABIS.publications.methods.set_identity_contract?.entry_point);
    expect(publications?.entryPoints).not.toContain(ABIS.publications.methods.set_relationships_contract?.entry_point);
    expect(publications?.entryPoints).not.toContain(ABIS.publications.methods.get_post?.entry_point);
    // cached: the same signature is served again
    const second = (await app.inject({ method: "GET", url: "/.well-known/osp-sponsor.json" })).json() as SponsorDiscovery;
    expect(second.signature).toBe(doc.signature);
    // a tampered copy no longer verifies
    expect(verifySponsorDiscovery({ ...doc, policy: { ...doc.policy, maxRcPerOp: "1" } }).valid).toBe(false);
    // the document is exactly what @osp/sdk signSponsorDiscovery produces over these fields
    const { signature: _signature, ...unsigned } = doc;
    expect((await signSponsorDiscovery(unsigned, sponsorSigner)).signature).toBe(doc.signature);
    await app.close();
  });

  it("reflects an allowlist override", async () => {
    const { app } = await start({ config: { allowlist: "publications:publish, relationships:follow" } });
    const doc = (await app.inject({ method: "GET", url: "/.well-known/osp-sponsor.json" })).json() as SponsorDiscovery;
    expect(doc.policy.allowed).toHaveLength(2);
    expect(doc.policy.allowed.flatMap((a) => a.entryPoints).sort()).toEqual(
      [ABIS.publications.methods.publish?.entry_point, ABIS.relationships.methods.follow?.entry_point].sort(),
    );
    await app.close();
  });
});

describe("POST /v1/sponsor acceptance", () => {
  it("co-signs, broadcasts and records a valid payee-signed transaction", async () => {
    const harness = await start();
    const tx = await userTx(harness, [await reactOp(harness.client)]);
    expect(tx.signatures).toHaveLength(1);
    const { status, body } = await sponsorRequest(harness.app, tx);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.transaction.signatures).toHaveLength(2);
    expect(body.transaction.header.payer).toBe(sponsor);
    expect(body.transaction.header.payee).toBe(user.getAddress());
    expect(body.transaction.operations).toEqual(tx.operations);
    expect(body.transaction.id).toBe(tx.id);
    expect(body.transaction.wait).toBeUndefined();
    expect(await Signer.recoverAddresses(body.transaction as TransactionJson)).toEqual([user.getAddress(), sponsor]);
    expect(body.receipt.rc_used).toBe("123456");
    expect(harness.provider.sent).toHaveLength(1);
    expect(harness.provider.sent[0]?.broadcast).toBe(true);
    expect(harness.provider.sent[0]?.transaction.signatures).toHaveLength(2);
    const usage = harness.app.sponsorService.utilization();
    expect(usage.today.accepted).toBe(1);
    expect(usage.today.acceptedOps).toBe(1);
    expect(usage.today.rcUsed).toBe("123456");
    expect(usage.today.users).toBe(1);
    expect(harness.app.sponsorService.quota.dailyOps(user.getAddress())).toBe(1);
    await harness.app.close();
  });

  it("returns exactly the user's transaction with the sponsor signature appended", async () => {
    const harness = await start();
    const tx = await userTx(harness, [await reactOp(harness.client), await followOp(harness.client)], { rcLimit: "400000000" });
    const { status, body } = await sponsorRequest(harness.app, tx);
    expect(status, JSON.stringify(body)).toBe(200);
    const returned = body.transaction as TransactionJson;
    expect(returned.id).toBe(tx.id);
    expect(returned.header).toEqual(tx.header);
    expect(returned.operations).toEqual(tx.operations);
    expect(returned.signatures?.slice(0, 1)).toEqual(tx.signatures);
    expect(returned.signatures).toHaveLength(2);
    expect(Object.keys(returned).sort()).toEqual(["header", "id", "operations", "signatures"]);
    expect(body.receipt.id).toBe(tx.id);
    // the SDK's own check (same id/header/operations, user signatures preserved, receipt for the id)
    await expect(verifySponsorResult(tx, body as SponsorResult, "https://sponsor.test")).resolves.toBeUndefined();
    await harness.app.close();
  });

  it("accepts multi-operation transactions across contracts", async () => {
    const harness = await start();
    const ops = [
      await reactOp(harness.client),
      await followOp(harness.client),
      await harness.client.ops.identity.update_profile({ account: user.getAddress(), profile_hash: new Uint8Array(32), profile_uri: "ipfs://x" }),
    ];
    const tx = await userTx(harness, ops, { rcLimit: "600000000" });
    const { status } = await sponsorRequest(harness.app, tx);
    expect(status).toBe(200);
    expect(harness.app.sponsorService.utilization().today.acceptedOps).toBe(3);
    await harness.app.close();
  });

  it("accepts an operation acted through a device key when the device is the payee", async () => {
    const harness = await start();
    // the account is `other`, the signing device is `user` (spec section 3.2)
    const tx = await userTx(harness, [await reactOp(harness.client, other.getAddress(), user.getAddress())]);
    const { status } = await sponsorRequest(harness.app, tx);
    expect(status).toBe(200);
    await harness.app.close();
  });

  it("accepts a recovered identity whose current owner key is the payee", async () => {
    const identityEntryPoint = ABIS.identity.methods.get_identity!.entry_point;
    let lookups = 0;
    const harness = await start({
      provider: {
        onRead: (op) => {
          if (op.entry_point !== identityEntryPoint) return undefined;
          lookups += 1;
          const args = harness.client.contracts.decodeOperation({ call_contract: op })?.args as { account: string };
          return args.account === other.getAddress()
            ? encode("identity.get_identity_result", { value: { account: other.getAddress(), owner: user.getAddress(), encryption_key: new Uint8Array(32), key_version: 1 } })
            : undefined;
        },
      },
    });
    // `other` was recovered to the `user` key: user signs as payee for other's account
    const recovered = await harness.client.ops.identity.update_profile({ account: other.getAddress(), profile_hash: new Uint8Array(32), profile_uri: "" });
    const ok = await sponsorRequest(harness.app, await userTx(harness, [recovered, await reactOp(harness.client, other.getAddress())], { rcLimit: "400000000" }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(lookups).toBe(1); // one lookup per account per transaction
    // an unregistered or differently owned account is still refused
    const unknown = await harness.client.ops.identity.update_profile({ account: sponsor, profile_hash: new Uint8Array(32), profile_uri: "" });
    await expectRefusal(harness.app, await userTx(harness, [unknown]), 400, "invalid_transaction", /owner/);
    // a device-bound operation never consults the owner
    const withDevice = await reactOp(harness.client, other.getAddress(), sponsor);
    await expectRefusal(harness.app, await userTx(harness, [withDevice]), 400, "invalid_transaction", /device/);
    // an RPC failure during the lookup is temporarily_unavailable, not a silent refusal
    harness.provider.readContract = async () => {
      throw new Error("fetch failed");
    };
    await expectRefusal(harness.app, await userTx(harness, [recovered]), 503, "temporarily_unavailable", /owner/);
    await harness.app.close();
  });

  it("works end to end through the SDK ProtocolClient.submit", async () => {
    const harness = await start();
    const sponsorClient = new SponsorClient({ endpoint: "https://sponsor.test", fetch: injectFetch(harness.app), expectedChainId: HARBINGER_CHAIN_ID });
    // Without an explicit rcLimit the SDK caps rc_limit at policy.maxRcPerOp x operations, so
    // the sponsored path succeeds straight away (no refusal, no self-pay fallback).
    const uncapped = await harness.client.submit({ operations: [await followOp(harness.client)], signer: user, sponsor: sponsorClient });
    expect(uncapped.sponsored).toBe(true);
    expect(uncapped.sponsor).toBe(sponsor);
    expect(uncapped.refusals).toEqual([]);
    expect(harness.provider.sent).toHaveLength(1);
    expect(harness.provider.sent[0]?.transaction.header?.rc_limit).toBe("200000000");
    expect(harness.provider.sent[0]?.transaction.header?.payer).toBe(sponsor);
    harness.provider.sent.length = 0;
    // an explicit rcLimit still overrides the default cap
    const result = await harness.client.submit({ operations: [await followOp(harness.client)], signer: user, sponsor: sponsorClient, rcLimit: "150000000" });
    expect(result.sponsored).toBe(true);
    expect(result.sponsor).toBe(sponsor);
    expect(result.refusals).toEqual([]);
    expect(result.transaction.signatures).toHaveLength(2);
    expect(harness.provider.sent).toHaveLength(1);
    expect(harness.provider.sent[0]?.transaction.header?.rc_limit).toBe("150000000");
    expect(harness.provider.sent[0]?.transaction.header?.payee).toBe(user.getAddress());
    // an rcLimit above the ceiling is refused and the SDK self-pays
    harness.provider.sent.length = 0;
    const over = await harness.client.submit({ operations: [await followOp(harness.client)], signer: user, sponsor: sponsorClient, rcLimit: "200000001" });
    expect(over.sponsored).toBe(false);
    expect(over.refusals.map((r) => r.error.category)).toEqual(["too_large"]);
    expect(harness.provider.sent).toHaveLength(1);
    expect(harness.provider.sent[0]?.transaction.header?.payer).toBe(user.getAddress());
    // utilization is reachable through the SDK client too
    const utilization = await sponsorClient.utilization();
    expect((utilization.today as { accepted: number }).accepted).toBe(2);
    await harness.app.close();
  });

  it("passes a timeout receipt (rpc_error) through as 200 so the SDK never re-submits", async () => {
    const rpcError = { message: "rpc failed, context deadline exceeded" };
    const harness = await start({ provider: { onSend: () => ({ rpc_error: rpcError, rc_used: "" } as never) } });
    const tx = await userTx(harness, [await followOp(harness.client)]);
    const { status, body } = await sponsorRequest(harness.app, tx);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.receipt.rpc_error).toEqual(rpcError);
    expect(body.receipt.id).toBe(tx.id);
    expect(body.transaction.id).toBe(tx.id);
    expect(body.transaction.signatures).toHaveLength(2);
    // the sponsor may have paid: usage stays recorded
    const usage = harness.app.sponsorService.utilization();
    expect(usage.today.accepted).toBe(1);
    expect(usage.today.refused.temporarily_unavailable).toBe(0);
    expect(harness.app.sponsorService.quota.dailyOps(user.getAddress())).toBe(1);
    // through the SDK: an unknown outcome, not a refusal, and no second broadcast (self-pay)
    harness.provider.sent.length = 0;
    const sponsorClient = new SponsorClient({ endpoint: "https://sponsor.test", fetch: injectFetch(harness.app), expectedChainId: HARBINGER_CHAIN_ID });
    const error = await harness.client.submit({ operations: [await followOp(harness.client)], signer: user, sponsor: sponsorClient }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionOutcomeUnknownError);
    expect((error as TransactionOutcomeUnknownError).rpcError).toEqual(rpcError);
    expect(harness.provider.sent).toHaveLength(1);
    expect(harness.provider.sent[0]?.transaction.header?.payer).toBe(sponsor);
    await harness.app.close();
  });

  it("requires the owner for authorize_device and revoke_device (device is the subject, not a signer)", async () => {
    const identityEntryPoint = ABIS.identity.methods.get_identity!.entry_point;
    const harness = await start({
      provider: {
        onRead: (op) => {
          if (op.entry_point !== identityEntryPoint) return undefined;
          const args = harness.client.contracts.decodeOperation({ call_contract: op })?.args as { account: string };
          return args.account === other.getAddress()
            ? encode("identity.get_identity_result", { value: { account: other.getAddress(), owner: user.getAddress(), encryption_key: new Uint8Array(32), key_version: 1 } })
            : undefined;
        },
      },
    });
    for (const method of ["authorize_device", "revoke_device"] as const) {
      // the payee is the device being (de)authorised on someone else's account: not the owner
      const asDevice = await userTx(harness, [await deviceOp(harness.client, method, sponsor, user.getAddress())]);
      await expectRefusal(harness.app, asDevice, 400, "invalid_transaction", new RegExp(`${method}\\.account`));
      // the account itself signs: fine
      const asOwner = await userTx(harness, [await deviceOp(harness.client, method, user.getAddress(), other.getAddress())]);
      expect((await sponsorRequest(harness.app, asOwner)).status).toBe(200);
      // a recovered identity whose current owner key is the payee: fine (owner lookup)
      const recovered = await userTx(harness, [await deviceOp(harness.client, method, other.getAddress(), sponsor)]);
      expect((await sponsorRequest(harness.app, recovered)).status).toBe(200);
    }
    // for methods where `device` is a signing authority the device may still be the payee
    const viaDevice = await userTx(harness, [await reactOp(harness.client, other.getAddress(), user.getAddress())]);
    expect((await sponsorRequest(harness.app, viaDevice)).status).toBe(200);
    expect(harness.provider.sent).toHaveLength(5);
    await harness.app.close();
  });
});

describe("POST /v1/sponsor refusals", () => {
  it("refuses a transaction for another chain", async () => {
    const harness = await start();
    const tx = await userTx(harness, [await reactOp(harness.client)], { chainId: "EiB" + "A".repeat(43) + "=" });
    await expectRefusal(harness.app, tx, 400, "chain_mismatch");
    expect(harness.provider.sent).toHaveLength(0);
    await harness.app.close();
  });

  it("refuses when the payer is not the sponsor", async () => {
    const harness = await start();
    const selfPaid = await userTx(harness, [await reactOp(harness.client)], { payer: user.getAddress() });
    await expectRefusal(harness.app, selfPaid, 400, "invalid_transaction", /payer/);
    const otherPayer = await userTx(harness, [await reactOp(harness.client)], { payer: other.getAddress() });
    await expectRefusal(harness.app, otherPayer, 400, "invalid_transaction", /payer/);
    await harness.app.close();
  });

  it("refuses when the payee is the sponsor itself", async () => {
    const harness = await start();
    const tx = await userTx(harness, [await reactOp(harness.client, sponsor)], { signer: sponsorSigner });
    await expectRefusal(harness.app, tx, 400, "invalid_transaction", /payee/);
    await harness.app.close();
  });

  it("refuses methods outside the allowlist", async () => {
    const harness = await start();
    const grant = await harness.client.ops.sponsorship.set_user_grant({ sponsor: user.getAddress(), user: other.getAddress(), daily_ops: 5, expires_at: "1" });
    await expectRefusal(harness.app, await userTx(harness, [grant]), 403, "method_not_allowed");
    const registry = await harness.client.ops.registry.propose_contract({ name: "x", address: user.getAddress(), version: 1 } as never);
    await expectRefusal(harness.app, await userTx(harness, [registry]), 403, "method_not_allowed");
    expect(harness.app.sponsorService.utilization().today.refused.method_not_allowed).toBe(2);
    await harness.app.close();
  });

  it("refuses the admin setters even though they are write methods of sponsored contracts", async () => {
    const harness = await start();
    const setIdentity = await harness.client.ops.publications.set_identity_contract({ address: user.getAddress() });
    await expectRefusal(harness.app, await userTx(harness, [setIdentity]), 403, "method_not_allowed");
    const setRelationships = await harness.client.ops.publications.set_relationships_contract({ address: user.getAddress() });
    await expectRefusal(harness.app, await userTx(harness, [setRelationships]), 403, "method_not_allowed");
    const communities = await harness.client.ops.communities.set_identity_contract({ address: user.getAddress() });
    await expectRefusal(harness.app, await userTx(harness, [communities]), 403, "method_not_allowed");
    await harness.app.close();
  });

  it("refuses operations that are not call_contract", async () => {
    const harness = await start();
    const upload: OperationJson = { upload_contract: { contract_id: user.getAddress(), bytecode: "AAECAw==" } };
    const prepared = await Transaction.prepareTransaction(
      { header: { chain_id: HARBINGER_CHAIN_ID, rc_limit: "1000", nonce: await harness.provider.getNextNonce(user.getAddress()), payer: sponsor, payee: user.getAddress() }, operations: [upload] },
      undefined,
      sponsor,
    );
    await expectRefusal(harness.app, await user.signTransaction(prepared), 403, "method_not_allowed", /call_contract/);
    await harness.app.close();
  });

  it("refuses a read-only entry point of a sponsored contract", async () => {
    const harness = await start();
    const read = await harness.client.contracts.operation("publications", "get_post", { post_id: postId });
    await expectRefusal(harness.app, await userTx(harness, [read]), 403, "method_not_allowed");
    await harness.app.close();
  });

  it("refuses oversize operation arguments", async () => {
    const harness = await start();
    const publish = await harness.client.ops.publications.publish({
      author: user.getAddress(),
      post_id: postId,
      sequence: "1",
      envelope: new Uint8Array(7000).fill(9),
      content_hash: new Uint8Array(32).fill(1),
      idempotency_key: new Uint8Array(16).fill(2),
    });
    await expectRefusal(harness.app, await userTx(harness, [publish]), 413, "too_large", /bytes/);
    await harness.app.close();
  });

  it("refuses too many operations and an rc_limit above the ceiling", async () => {
    const harness = await start();
    const five = await Promise.all([1, 2, 3, 4, 5].map(() => reactOp(harness.client)));
    await expectRefusal(harness.app, await userTx(harness, five, { rcLimit: "1000000000" }), 413, "too_large", /operations/);
    const highRc = await userTx(harness, [await reactOp(harness.client)], { rcLimit: "200000001" });
    await expectRefusal(harness.app, highRc, 413, "too_large", /rc_limit/);
    const exactRc = await userTx(harness, [await reactOp(harness.client), await followOp(harness.client)], { rcLimit: "400000000" });
    expect((await sponsorRequest(harness.app, exactRc)).status).toBe(200);
    await harness.app.close();
  });

  it("refuses when the acting account is not the payee (quota gaming)", async () => {
    const harness = await start();
    const tx = await userTx(harness, [await reactOp(harness.client, other.getAddress())]);
    await expectRefusal(harness.app, tx, 400, "invalid_transaction", /actor/);
    // a device that is not the payee does not help
    const device = await userTx(harness, [await reactOp(harness.client, other.getAddress(), sponsor)]);
    await expectRefusal(harness.app, device, 400, "invalid_transaction", /actor/);
    // the guardian, not the account, must be the payee for propose_recovery
    const recovery = await harness.client.ops.identity.propose_recovery({ account: user.getAddress(), guardian: other.getAddress(), new_owner: other.getAddress() });
    await expectRefusal(harness.app, await userTx(harness, [recovery]), 400, "invalid_transaction", /guardian/);
    const asGuardian = await harness.client.ops.identity.propose_recovery({ account: other.getAddress(), guardian: user.getAddress(), new_owner: user.getAddress() });
    expect((await sponsorRequest(harness.app, await userTx(harness, [asGuardian]))).status).toBe(200);
    await harness.app.close();
  });

  it("refuses missing, foreign and stale signatures", async () => {
    const harness = await start();
    const unsigned = await userTx(harness, [await reactOp(harness.client)], { sign: false });
    await expectRefusal(harness.app, unsigned, 400, "invalid_signature", /no user signature/);
    await expectRefusal(harness.app, { ...unsigned, signatures: ["not-a-signature"] }, 400, "invalid_signature");
    const foreign = await userTx(harness, [await reactOp(harness.client)], { signer: other, payee: user.getAddress() });
    await expectRefusal(harness.app, foreign, 400, "invalid_signature", /payee/);
    // header changed after signing: the id (and signature) no longer match
    const signed = await userTx(harness, [await reactOp(harness.client)]);
    const tampered = { ...signed, header: { ...signed.header, rc_limit: "1" } };
    await expectRefusal(harness.app, tampered, 400, "invalid_signature", /id/);
    // operations swapped after signing: merkle root mismatch
    const swapped = { ...signed, operations: [await followOp(harness.client)] };
    await expectRefusal(harness.app, swapped, 400, "invalid_signature", /merkle/);
    // structurally broken transactions
    await expectRefusal(harness.app, undefined, 400, "invalid_transaction");
    await expectRefusal(harness.app, { ...signed, header: { ...signed.header, chain_id: undefined } }, 400, "chain_mismatch");
    await expectRefusal(harness.app, { ...signed, operations: [] }, 400, "invalid_transaction");
    expect(harness.provider.sent).toHaveLength(0);
    await harness.app.close();
  });

  it("enforces the daily quota", async () => {
    const harness = await start({ config: { dailyOps: 3, burstOps: 10 } });
    expect((await sponsorRequest(harness.app, await userTx(harness, [await reactOp(harness.client)]))).status).toBe(200);
    const two = await userTx(harness, [await reactOp(harness.client), await followOp(harness.client)], { rcLimit: "400000000" });
    expect((await sponsorRequest(harness.app, two)).status).toBe(200);
    const refused = await expectRefusal(harness.app, await userTx(harness, [await reactOp(harness.client)]), 429, "quota_exceeded", /daily/);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    expect(refused.body.error.retryAfterSec).toBeGreaterThan(0);
    // another user is unaffected
    const otherTx = await userTx(harness, [await reactOp(harness.client, other.getAddress())], { signer: other });
    expect((await sponsorRequest(harness.app, otherTx)).status).toBe(200);
    expect(harness.provider.sent).toHaveLength(3);
    const usage = harness.app.sponsorService.utilization();
    expect(usage.today.accepted).toBe(3);
    expect(usage.today.acceptedOps).toBe(4);
    expect(usage.today.refused.quota_exceeded).toBe(1);
    expect(usage.today.users).toBe(2);
    await harness.app.close();
  });

  it("enforces the burst window and releases it as time passes", async () => {
    let now = Date.UTC(2026, 8, 5, 12, 0, 0);
    const harness = await start({ config: { dailyOps: 100, burstOps: 2, burstWindowSec: 60 }, now: () => now });
    expect((await sponsorRequest(harness.app, await userTx(harness, [await reactOp(harness.client)]))).status).toBe(200);
    now += 10_000;
    expect((await sponsorRequest(harness.app, await userTx(harness, [await reactOp(harness.client)]))).status).toBe(200);
    now += 10_000;
    const refused = await expectRefusal(harness.app, await userTx(harness, [await reactOp(harness.client)]), 429, "quota_exceeded", /burst/);
    expect(refused.body.error.retryAfterSec).toBeLessThanOrEqual(60);
    now += 45_000; // the first op falls out of the 60 s window
    expect((await sponsorRequest(harness.app, await userTx(harness, [await reactOp(harness.client)]))).status).toBe(200);
    expect(harness.app.sponsorService.quota.dailyOps(user.getAddress(), now)).toBe(3);
    await harness.app.close();
  });

  it("reserves quota before broadcasting so concurrent requests cannot exceed it", async () => {
    // Ten pre-signed transactions (sequential nonces) fired at once against a slow node: the
    // old check-then-record flow let all ten through because every handler saw empty counters.
    const daily = await start({ config: { dailyOps: 4, burstOps: 10 }, provider: { sendDelayMs: 20 } });
    const txs = await Promise.all([...Array(10).keys()].map(async (i) => userTx(daily, [await reactOp(daily.client)], { nonce: nonceValue(i + 1) })));
    expect(new Set(txs.map((tx) => tx.id)).size).toBe(10);
    const results = await Promise.all(txs.map((tx) => sponsorRequest(daily.app, tx)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(4);
    const refused = results.filter((r) => r.status === 429);
    expect(refused).toHaveLength(6);
    expect(refused.every((r) => r.body.error.category === "quota_exceeded" && /daily/.test(r.body.error.message))).toBe(true);
    expect(daily.provider.sent).toHaveLength(4);
    expect(daily.app.sponsorService.quota.dailyOps(user.getAddress())).toBe(4);
    const usage = daily.app.sponsorService.utilization();
    expect(usage.today.accepted).toBe(4);
    expect(usage.today.acceptedOps).toBe(4);
    expect(usage.today.refused.quota_exceeded).toBe(6);
    expect(usage.today.users).toBe(1);
    await daily.app.close();

    // the burst window is reserved the same way
    const burst = await start({ config: { dailyOps: 100, burstOps: 3, burstWindowSec: 60 }, provider: { sendDelayMs: 20 } });
    const more = await Promise.all([...Array(8).keys()].map(async (i) => userTx(burst, [await reactOp(burst.client)], { nonce: nonceValue(i + 1) })));
    const outcomes = await Promise.all(more.map((tx) => sponsorRequest(burst.app, tx)));
    expect(outcomes.filter((r) => r.status === 200)).toHaveLength(3);
    expect(outcomes.filter((r) => r.status === 429 && /burst/.test(r.body.error.message))).toHaveLength(5);
    expect(burst.provider.sent).toHaveLength(3);
    expect(burst.app.sponsorService.quota.burstOps(user.getAddress())).toBe(3);
    await burst.app.close();
  });

  it("releases the reservation when nothing was broadcast", async () => {
    let failure: Error | undefined = new Error("fetch failed: ECONNREFUSED");
    const harness = await start({
      config: { dailyOps: 1, burstOps: 1 },
      provider: {
        onSend: () => {
          if (failure) throw failure;
          return undefined;
        },
      },
    });
    const quota = harness.app.sponsorService.quota;
    // transport failure: nothing was paid, the operations go back to the user
    await expectRefusal(harness.app, await userTx(harness, [await reactOp(harness.client)]), 503, "temporarily_unavailable");
    expect(quota.dailyOps(user.getAddress())).toBe(0);
    expect(quota.burstOps(user.getAddress())).toBe(0);
    expect(harness.app.sponsorService.utilization().today.users).toBe(0);
    // chain rejection: same
    failure = new Error(JSON.stringify({ error: "transaction reverted", logs: ["insufficient rc"] }));
    await expectRefusal(harness.app, await userTx(harness, [await reactOp(harness.client)]), 400, "invalid_transaction");
    expect(quota.dailyOps(user.getAddress())).toBe(0);
    // the next broadcast succeeds and consumes the (tiny) quota
    failure = undefined;
    expect((await sponsorRequest(harness.app, await userTx(harness, [await reactOp(harness.client)]))).status).toBe(200);
    expect(quota.dailyOps(user.getAddress())).toBe(1);
    await expectRefusal(harness.app, await userTx(harness, [await reactOp(harness.client)]), 429, "quota_exceeded");
    const usage = harness.app.sponsorService.utilization();
    expect(usage.today.accepted).toBe(1);
    expect(usage.today.users).toBe(1);
    expect(usage.today.refused).toMatchObject({ temporarily_unavailable: 1, invalid_transaction: 1, quota_exceeded: 1 });
    await harness.app.close();
  });

  it("verifies the signatures before consulting the chain for owner lookups", async () => {
    const identityEntryPoint = ABIS.identity.methods.get_identity!.entry_point;
    const harness = await start({
      provider: {
        onRead: (op) =>
          op.entry_point === identityEntryPoint
            ? encode("identity.get_identity_result", { value: { account: other.getAddress(), owner: user.getAddress(), encryption_key: new Uint8Array(32), key_version: 1 } })
            : undefined,
      },
    });
    // `other` was recovered to the `user` key; the actor is neither the payee nor a device
    const recovered = await harness.client.ops.identity.update_profile({ account: other.getAddress(), profile_hash: new Uint8Array(32), profile_uri: "" });
    const unsigned = await userTx(harness, [recovered], { sign: false });
    await expectRefusal(harness.app, unsigned, 400, "invalid_signature");
    await expectRefusal(harness.app, { ...unsigned, signatures: ["not-a-signature"] }, 400, "invalid_signature");
    const foreign = await userTx(harness, [recovered], { signer: other, payee: user.getAddress() });
    await expectRefusal(harness.app, foreign, 400, "invalid_signature", /payee/);
    const signed = await userTx(harness, [recovered]);
    await expectRefusal(harness.app, { ...signed, header: { ...signed.header, rc_limit: "1" } }, 400, "invalid_signature", /id/);
    // none of those cost an RPC call
    expect(harness.provider.reads).toHaveLength(0);
    expect(harness.provider.sent).toHaveLength(0);
    // a payee-signed request performs the lookup (once) and is accepted
    expect((await sponsorRequest(harness.app, signed)).status).toBe(200);
    expect(harness.provider.reads).toHaveLength(1);
    await harness.app.close();
  });

  it("returns the receipt logs for reverted transactions and still counts them", async () => {
    const harness = await start({ config: { dailyOps: 1 }, provider: { onSend: () => ({ reverted: true, logs: ["publish: sequence mismatch"], rc_used: "999" }) } });
    const result = await expectRefusal(harness.app, await userTx(harness, [await reactOp(harness.client)]), 400, "invalid_transaction", /sequence mismatch/);
    expect(result.body.error.logs).toEqual(["publish: sequence mismatch"]);
    expect(result.body.receipt.reverted).toBe(true);
    expect(harness.provider.sent).toHaveLength(1);
    const usage = harness.app.sponsorService.utilization();
    expect(usage.today.accepted).toBe(1);
    expect(usage.today.reverted).toBe(1);
    expect(usage.today.rcUsed).toBe("999");
    // the reverted transaction consumed the (tiny) daily quota
    await expectRefusal(harness.app, await userTx(harness, [await reactOp(harness.client)]), 429, "quota_exceeded");
    await harness.app.close();
  });

  it("maps RPC failures to temporarily_unavailable and chain rejections to invalid_transaction", async () => {
    let failure: Error | undefined = new Error("fetch failed: ECONNREFUSED");
    const harness = await start({
      provider: {
        onSend: () => {
          if (failure) throw failure;
          return undefined;
        },
      },
    });
    await expectRefusal(harness.app, await userTx(harness, [await reactOp(harness.client)]), 503, "temporarily_unavailable", /ECONNREFUSED/);
    failure = new Error(JSON.stringify({ error: "transaction reverted", logs: ["insufficient rc"] }));
    const rejected = await expectRefusal(harness.app, await userTx(harness, [await reactOp(harness.client)]), 400, "invalid_transaction", /reverted/);
    expect(rejected.body.error.logs).toEqual(["insufficient rc"]);
    failure = undefined;
    expect((await sponsorRequest(harness.app, await userTx(harness, [await reactOp(harness.client)]))).status).toBe(200);
    const usage = harness.app.sponsorService.utilization();
    expect(usage.today.refused.temporarily_unavailable).toBe(1);
    expect(usage.today.refused.invalid_transaction).toBe(1);
    expect(usage.today.accepted).toBe(1);
    await harness.app.close();
  });
});

describe("POST /v1/prepare", () => {
  it("returns an unsigned sponsored transaction that /v1/sponsor accepts once signed", async () => {
    const harness = await start({ provider: { nonces: { [user.getAddress()]: 41 } } });
    const op = await reactOp(harness.client);
    const response = await harness.app.inject({ method: "POST", url: "/v1/prepare", payload: { payee: user.getAddress(), operations: [op] } });
    expect(response.statusCode, response.body).toBe(200);
    const { transaction } = response.json() as { transaction: TransactionJson };
    expect(transaction.header?.payer).toBe(sponsor);
    expect(transaction.header?.payee).toBe(user.getAddress());
    expect(transaction.header?.chain_id).toBe(HARBINGER_CHAIN_ID);
    expect(transaction.header?.nonce).toBe(await harness.provider.getNextNonce(user.getAddress()));
    expect(transaction.header?.rc_limit).toBe("200000000");
    expect(transaction.id?.startsWith("0x1220")).toBe(true);
    expect(transaction.signatures ?? []).toHaveLength(0);
    expect(transaction.operations).toEqual([op]);
    const signed = await user.signTransaction({ ...transaction, signatures: [] });
    const { status, body } = await sponsorRequest(harness.app, signed);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.transaction.signatures).toHaveLength(2);
    await harness.app.close();
  });

  it("caps rc_limit at the sponsor's available RC and validates operations first", async () => {
    const harness = await start({ provider: { rc: { [sponsor]: "5000" } } });
    const ok = await harness.app.inject({ method: "POST", url: "/v1/prepare", payload: { payee: user.getAddress(), operations: [await reactOp(harness.client)] } });
    expect((ok.json() as { transaction: TransactionJson }).transaction.header?.rc_limit).toBe("5000");
    const unlisted = await harness.app.inject({
      method: "POST",
      url: "/v1/prepare",
      payload: { payee: user.getAddress(), operations: [await harness.client.ops.publications.set_identity_contract({ address: user.getAddress() })] },
    });
    expect(unlisted.statusCode).toBe(403);
    expect((unlisted.json() as { error: { category: string } }).error.category).toBe("method_not_allowed");
    const mismatch = await harness.app.inject({ method: "POST", url: "/v1/prepare", payload: { payee: user.getAddress(), operations: [await reactOp(harness.client, other.getAddress())] } });
    expect((mismatch.json() as { error: { category: string } }).error.category).toBe("invalid_transaction");
    const badPayee = await harness.app.inject({ method: "POST", url: "/v1/prepare", payload: { payee: "nope", operations: [await reactOp(harness.client)] } });
    expect(badPayee.statusCode).toBe(400);
    expect(harness.provider.sent).toHaveLength(0);
    await harness.app.close();
  });

  it("works through the SDK SponsorClient.prepare", async () => {
    const harness = await start();
    const sponsorClient = new SponsorClient({ endpoint: "https://sponsor.test", fetch: injectFetch(harness.app) });
    const tx = await sponsorClient.prepare(user.getAddress(), [await followOp(harness.client)]);
    const signed = await user.signTransaction({ ...tx, signatures: [] });
    const result = await sponsorClient.sponsor(signed);
    expect(result.transaction.signatures).toHaveLength(2);
    expect(result.receipt.reverted).toBe(false);
    await harness.app.close();
  });
});

describe("utilization and health", () => {
  it("publishes aggregate counters only", async () => {
    const harness = await start();
    expect((await sponsorRequest(harness.app, await userTx(harness, [await reactOp(harness.client)]))).status).toBe(200);
    await expectRefusal(harness.app, await userTx(harness, [await reactOp(harness.client, other.getAddress())]), 400, "invalid_transaction");
    const response = await harness.app.inject({ method: "GET", url: "/v1/utilization" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, any>;
    expect(body.today.accepted).toBe(1);
    expect(body.today.acceptedOps).toBe(1);
    expect(body.today.refused.invalid_transaction).toBe(1);
    expect(body.today.refusedTotal).toBe(1);
    expect(body.yesterday.accepted).toBe(0);
    expect(body.limits).toEqual({ dailyOps: 200, burstOps: 20, burstWindowSec: 60 });
    expect(response.body).not.toContain(user.getAddress());
    expect(response.body).not.toContain(other.getAddress());
    await harness.app.close();
  });

  it("reports health and state", async () => {
    const harness = await start();
    const health = await harness.app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    const body = health.json() as Record<string, any>;
    expect(body.ok).toBe(true);
    expect(body.state).toBe("serving");
    expect(body.sponsor).toBe(sponsor);
    expect(body.chainId).toBe(HARBINGER_CHAIN_ID);
    expect(body.allowed).toContain("publications.publish");
    expect(body.allowed).not.toContain("publications.set_identity_contract");
    const missing = await harness.app.inject({ method: "GET", url: "/nope" });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: { category: string } }).error.category).toBe("invalid_transaction");
    const badJson = await harness.app.inject({ method: "POST", url: "/v1/sponsor", payload: "{not json", headers: { "content-type": "application/json" } });
    expect(badJson.statusCode).toBe(400);
    expect((badJson.json() as { error: { category: string } }).error.category).toBe("invalid_transaction");
    await harness.app.close();
  });

  it("starts without a deployment manifest and reports the not-deployed state", async () => {
    const harness = await start({ deployment: null });
    const health = await harness.app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(503);
    const body = health.json() as Record<string, any>;
    expect(body.ok).toBe(false);
    expect(body.state).toBe("not_deployed");
    expect(body.message).toMatch(/not deployed/);
    for (const route of [
      { method: "GET" as const, url: "/.well-known/osp-sponsor.json" },
      { method: "POST" as const, url: "/v1/prepare", payload: { payee: user.getAddress(), operations: [] } },
      { method: "POST" as const, url: "/v1/sponsor", payload: { transaction: {} } },
    ]) {
      const response = await harness.app.inject(route);
      expect(response.statusCode).toBe(503);
      expect((response.json() as { error: { category: string } }).error.category).toBe("temporarily_unavailable");
    }
    expect((await harness.app.inject({ method: "GET", url: "/v1/utilization" })).statusCode).toBe(200);
    await harness.app.close();
  });

  it("starts without a key and reports the no-key state", async () => {
    const harness = await start({ signer: null });
    const health = await harness.app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(503);
    const body = health.json() as Record<string, any>;
    expect(body.state).toBe("no_key");
    expect(body.sponsor).toBeNull();
    expect(body.allowed.length).toBeGreaterThan(0);
    const discovery = await harness.app.inject({ method: "GET", url: "/.well-known/osp-sponsor.json" });
    expect(discovery.statusCode).toBe(503);
    await harness.app.close();
  });
});
