import { describe, expect, it, vi } from "vitest";
import { ABIS } from "@osp/proto";
import { decode, encode, Signer, toBase64url, type TransactionJson } from "@osp/sdk";
import { RewardSettler } from "./rewardSettlement.js";
import { SponsorService } from "./server.js";
import { fakeProvider, fixtureDeployment, testConfig } from "./__tests__/helpers.js";

const deployment = fixtureDeployment();
const signer = Signer.fromSeed("reward settlement payer");
const author = Signer.fromSeed("reward owner, offline").getAddress();
const actor = signer.getAddress();
const post = new Uint8Array(32).fill(4);
const song = new Uint8Array([1, ...post]);
const comment = new Uint8Array([2, ...post, ...post]);
const other = new Uint8Array(32).fill(10);
type Page = { items: string[]; nextCursor: string | null };

function setup() {
  const state = {
    healthy: true, supported: true, block: 101, end: 100, chainId: deployment.chainId, mana: "500000000",
    tip: new Map<string, "open" | "settled" | "missing">(), errorOnce: false, timeoutAfterInclusion: false, applied: true,
    pages: new Map<string, Page>([["", {items: [toBase64url(post)], nextCursor: null}]]),
    submitted: [] as string[], cursors: [] as string[],
  };
  const methods = ABIS.token.methods;
  const provider = fakeProvider({ onRead: op => {
    if (op.entry_point === methods.get_economy!.entry_point) return encode("token.get_economy_result", {
      self_paid_settlement: state.supported, value: { version: 1 }, block: String(state.block),
    });
    if (op.entry_point !== methods.get_post_economy!.entry_point) throw Error("unexpected read");
    const id = decode("token.get_post_economy_arguments", op.args!).post_id as Uint8Array;
    const idString = toBase64url(id);
    const tip = state.tip.get(idString);
    const reward = { post_id: id, version: post, author, epoch: "1", score: "0", settled: tip === "settled" };
    return encode("token.get_post_economy_result", {
      block: String(state.block), ...(tip !== "missing" && { reward, epoch: { id: "1", end_block: String(tip === "open" ? state.block + 1 : state.end) } }),
    });
  } });
  provider.getAccountRc = async () => state.mana;
  const config = testConfig();
  const service = new SponsorService({ config, deployment, provider, signer });
  const client = service.client!;
  const send = provider.sendTransaction;
  provider.sendTransaction = async (tx: TransactionJson, broadcast) => {
    const op = client.contracts.decodeOperation(tx.operations![0]!)!;
    expect(op.method).toBe("settle_reward");
    expect(op.args.actor).toBe(actor);
    expect(tx.header?.payer).toBe(actor);
    expect(tx.header?.payee).toBeUndefined();
    expect(await Signer.recoverAddresses(tx)).toEqual([actor]);
    const idString = toBase64url(op.args.post_id as Uint8Array);
    state.submitted.push(idString);
    if (state.errorOnce) { state.errorOnce = false; throw new Error("temporary rejection"); }
    if (state.applied) state.tip.set(idString, "settled");
    const response = await send(tx, broadcast);
    if (state.timeoutAfterInclusion) return { ...response, transaction: {
      ...response.transaction, wait: async () => { throw Error("RPC lost confirmation"); },
    } };
    return response;
  };
  const request: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/status") {
      return Response.json({ features: {rewardSettlementQueue: 1}, healthy: state.healthy, chainId: state.chainId, chainIdMatch: true, indexed: {height: 101}, contracts: {token: deployment.contracts.token.address} });
    }
    expect(url.pathname).toBe("/v1/token/settlements/due");
    expect(Number(url.searchParams.get("limit"))).toBe(4);
    const cursor = url.searchParams.get("cursor") ?? "";
    state.cursors.push(cursor);
    return Response.json(state.pages.get(cursor));
  };
  const worker = new RewardSettler(client, signer, config, job => service.withPayerNonce(job), request);
  return { state, service, worker };
}

describe("automatic OSAT settlement", () => {
  it("settles old eligible posts, songs and song comments for offline authors, once, including zero-score targets", async () => {
    const { state, worker, service } = setup();
    const ids = [post, song, comment].map(toBase64url);
    state.pages.set("", { items: ids, nextCursor: null });
    await Promise.all([worker.runOnce(), worker.runOnce()]);
    await worker.runOnce(); // lagging indexer still returns all three IDs
    expect(state.submitted).toEqual(ids);
    expect(worker.status).toMatchObject({ state: "ready", lastError: null, lastSettledAt: expect.any(String) });
    await service.close();
  });

  it("only reports a confirmed settlement after the contract records it", async () => {
    const { state, worker, service } = setup();
    state.applied = false;
    await worker.runOnce();
    expect(worker.status.lastSettledAt).toBeNull();
    expect(worker.status.lastError).toMatch(/awaiting confirmation/);
    state.applied = true;
    await worker.runOnce();
    expect(worker.status).toMatchObject({ state: "ready", lastSettledAt: expect.any(String) });
    await service.close();
  });

  it("advances past a failure and wraps to retry, including when a page shrinks", async () => {
    const { state, worker, service } = setup();
    const a = toBase64url(post), b = toBase64url(other), cursor = "10." + a;
    state.pages.set("", { items: [a], nextCursor: cursor });
    state.pages.set(cursor, { items: [b], nextCursor: null });
    state.errorOnce = true;
    await worker.runOnce();
    expect(worker.status.state).toBe("degraded");
    await worker.runOnce(); await worker.runOnce();
    expect(state.cursors).toEqual(["", cursor, ""]);
    expect(state.submitted).toEqual([a,b,a]);
    expect(worker.status.state).toBe("ready");
    await service.close();
  });

  it("reconciles an included settlement whose confirmation was lost, without paying twice", async () => {
    const { state, worker, service } = setup();
    state.timeoutAfterInclusion = true;
    await worker.runOnce();
    expect(worker.status.state).toBe("degraded");
    expect(worker.status.lastSettledAt).toBeNull();
    await worker.runOnce();
    expect(worker.status.state).toBe("ready");
    expect(state.submitted).toEqual([toBase64url(post)]);
    await service.close();
  });

  it("rechecks maturity on chain and preserves Mana for foreground traffic", async () => {
    const { state, worker, service } = setup();
    for (const condition of ["open", "missing", "settled"] as const) {
      state.tip.set(toBase64url(post), condition);
      await worker.runOnce();
    }
    state.tip.clear();
    state.mana = "399999999";
    await worker.runOnce();
    expect(worker.status.lastError).toMatch(/reserve Mana/);
    expect(state.submitted).toEqual([]);
    state.mana = "400000000"; state.block = state.end;
    await worker.runOnce();
    expect(state.submitted).toEqual([toBase64url(post)]);
    await service.close();
  });

  it("refuses mismatched deployments and old Token bytecode before any submit", async () => {
    const { state, worker, service } = setup();
    state.supported = false;
    await worker.runOnce();
    expect(worker.status.lastError).toMatch(/Upgrade Token/);
    state.supported = true; state.chainId = "wrong";
    await worker.runOnce();
    expect(worker.status.lastError).toMatch(/configured chain/);
    state.chainId = deployment.chainId; state.healthy = false;
    await worker.runOnce();
    expect(worker.status.lastError).toMatch(/synced and healthy/);
    expect(state.submitted).toEqual([]);
    await service.close();
  });

  it("waits for other sponsor-nonce work, then rechecks a reward already settled during the wait", async () => {
    const { state, worker, service } = setup();
    let release!: () => void;
    const held = service.withPayerNonce(() => new Promise<void>(r => { release = r; }));
    const lock = vi.spyOn(service, "withPayerNonce");
    const queued = worker.runOnce();
    await vi.waitFor(() => expect(lock).toHaveBeenCalled());
    expect(state.submitted).toEqual([]);
    state.tip.set(toBase64url(post), "settled");
    release(); await held; await queued;
    expect(state.submitted).toEqual([]);
    expect(worker.status.state).toBe("ready");
    await worker.stop(); await worker.runOnce();
    expect(state.cursors).toHaveLength(1);
    await service.close();
  });
});
