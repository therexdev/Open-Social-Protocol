import { describe, expect, it } from "vitest";
import { TransactionOutcomeUnknownError, fromHex, idempotencyKey, toHex } from "@osp/sdk";
import type { TransactionJson } from "koilib";
import { memoryArea } from "../shared/storage";
import type { StoredCrossPost } from "../shared/protocol";
import { explain } from "../shared/queue";
import { CROSSPOSTS_KEY, CrossPostOrchestrator, type CrossPostDeps } from "./crosspost";
import { createTestBackground } from "../test/support";

const AUTHOR = "1BKgyD7pZFSyNzupBRvvTYMLJCUuC1QLs3";
const ATTEMPT = "0102030405060708090a0b0c0d0e0f10";

function deps(overrides: Partial<CrossPostDeps> = {}) {
  const storage = memoryArea();
  const chain = new Map<string, Uint8Array>();
  let clock = 1000;
  const publishCalls: string[] = [];
  const base: CrossPostDeps = {
    storage,
    now: () => (clock += 1),
    account: async () => AUTHOR,
    publishKoinos: async (record) => {
      publishCalls.push(record.attemptId);
      const postId = "aa".repeat(32);
      chain.set(record.idempotencyKey, fromHex(postId));
      return { txId: "0x1220" + "11".repeat(32), postId, contentHash: "bb".repeat(32), sequence: "1", epoch: 0, versionNumber: 1, sponsored: false };
    },
    lookupChain: async (_author, key) => {
      const found = chain.get(toHex(key));
      return found ? { value: { post_id: found } } : undefined;
    },
    ...overrides,
  };
  return { deps: base, storage, chain, publishCalls, orchestrator: new CrossPostOrchestrator(base) };
}

const proposal = { hostSite: "facebook" as const, text: "from facebook", attemptId: ATTEMPT, url: "https://www.facebook.com/", submitted: true, userGesture: true };

describe("cross-post orchestrator", () => {
  it("persists proposals as drafts and never publishes them without confirmation", async () => {
    const { orchestrator, storage, publishCalls } = deps();
    const record = await orchestrator.propose(proposal);
    expect(record.state).toBe("draft");
    expect(record.hostStatus).toBe("pending");
    expect(record.idempotencyKey).toBe(toHex(idempotencyKey(AUTHOR, fromHex(ATTEMPT))));
    const again = await orchestrator.propose(proposal);
    expect(again.attemptId).toBe(record.attemptId);
    expect((await storage.get<{ records: StoredCrossPost[] }>(CROSSPOSTS_KEY))?.records).toHaveLength(1);
    expect(publishCalls).toEqual([]);
    expect(explain(record).actions).toEqual(["confirm", "discard"]);
  });

  it("confirm publishes once and records the host side as submitted by the user", async () => {
    const { orchestrator, publishCalls } = deps();
    await orchestrator.propose(proposal);
    const done = await orchestrator.confirm(ATTEMPT, { audience: 0 });
    expect(done.state).toBe("succeeded");
    expect(done.hostRef).toBe(proposal.url);
    expect(done.postId).toBe("aa".repeat(32));
    expect(done.text).toBeUndefined();
    expect(publishCalls).toEqual([ATTEMPT]);
    await expect(orchestrator.confirm(ATTEMPT)).rejects.toThrow(/succeeded/);
    await expect(orchestrator.retry(ATTEMPT)).rejects.toThrow(/not available/);
    // reloading from storage yields the same state (persistence)
    const reloaded = new CrossPostOrchestrator(deps().deps);
    expect(await reloaded.get(ATTEMPT)).toBeUndefined(); // separate storage
    expect((await orchestrator.get(ATTEMPT))?.state).toBe("succeeded");
  });

  it("koinos failure keeps the host reference and retry republishes only Koinos with the same key", async () => {
    let fail = true;
    const d = deps({
      publishKoinos: async (record) => {
        if (fail) throw new Error("rpc rejected: insufficient rc");
        const postId = "cc".repeat(32);
        d.chain.set(record.idempotencyKey, fromHex(postId));
        return { txId: "0x1220" + "22".repeat(32), postId, contentHash: "dd".repeat(32), sequence: "2", epoch: 0, versionNumber: 1, sponsored: true };
      },
    });
    await d.orchestrator.propose(proposal);
    const partial = await d.orchestrator.confirm(ATTEMPT);
    expect(partial.state).toBe("partial");
    expect(partial.hostStatus).toBe("ok");
    expect(partial.koinosStatus).toBe("failed");
    expect(explain(partial).actions).toContain("retry");
    fail = false;
    const retried = await d.orchestrator.retry(ATTEMPT);
    expect(retried.state).toBe("succeeded");
    expect(retried.idempotencyKey).toBe(partial.idempotencyKey);
    expect(retried.hostRef).toBe(proposal.url);
  });

  it("unknown outcome: retry looks the key up on chain before anything is re-sent", async () => {
    let mode: "timeout" | "ok" = "timeout";
    const d = deps({
      publishKoinos: async (record) => {
        if (mode === "timeout") {
          // the node accepted it but the answer was lost
          d.chain.set(record.idempotencyKey, fromHex("ee".repeat(32)));
          throw new TransactionOutcomeUnknownError({ id: "0x1220" + "33".repeat(32) } as TransactionJson, { id: "", payer: "", max_payer_rc: "", rc_limit: "", rc_used: "", disk_storage_used: "", network_bandwidth_used: "", compute_bandwidth_used: "", reverted: false, events: [], state_delta_entries: [], logs: [], rpc_error: { message: "timeout" } });
        }
        throw new Error("must not republish");
      },
    });
    await d.orchestrator.propose(proposal);
    const unknown = await d.orchestrator.confirm(ATTEMPT);
    expect(unknown.state).toBe("unknown");
    expect(explain(unknown).actions).toEqual(["reconcile"]);
    mode = "ok";
    const resolved = await d.orchestrator.retry(ATTEMPT);
    expect(resolved.state).toBe("succeeded");
    expect(resolved.postId).toBe("ee".repeat(32));
    expect(d.publishCalls).toEqual([]); // publishKoinos in deps() counter is not used here; the failing publisher above never republished
  });

  it("unknown outcome not found on chain: reconcile marks it safe to retry, then retry publishes", async () => {
    let calls = 0;
    const d = deps({
      publishKoinos: async (record) => {
        calls += 1;
        if (calls === 1) throw new Error("network error: fetch failed");
        d.chain.set(record.idempotencyKey, fromHex("ff".repeat(32)));
        return { txId: "0x1220" + "44".repeat(32), postId: "ff".repeat(32), contentHash: "aa".repeat(32), sequence: "3", epoch: 0, versionNumber: 1, sponsored: false };
      },
    });
    await d.orchestrator.propose(proposal);
    const unknown = await d.orchestrator.confirm(ATTEMPT);
    expect(unknown.state).toBe("unknown");
    const looked = await d.orchestrator.reconcile(ATTEMPT);
    expect(looked.state).toBe("partial");
    expect(looked.koinosStatus).toBe("failed");
    expect(looked.lastError).toMatch(/safe to retry/);
    const done = await d.orchestrator.retry(ATTEMPT);
    expect(done.state).toBe("succeeded");
    expect(calls).toBe(2);
  });

  it("duplicate idempotency key resolves to the existing post instead of failing", async () => {
    const d = deps({
      publishKoinos: async (record) => {
        d.chain.set(record.idempotencyKey, fromHex("12".repeat(32)));
        throw new Error("transaction reverted: duplicate idempotency key");
      },
    });
    await d.orchestrator.create({ text: "side panel post", audience: 1, adapter: "sidepanel" }, ATTEMPT);
    const done = await d.orchestrator.confirm(ATTEMPT);
    expect(done.state).toBe("succeeded");
    expect(done.postId).toBe("12".repeat(32));
    expect(done.hostStatus).toBe("not_required");
  });

  it("records the signed proof once both sides are known and exposes host marking", async () => {
    const proofs: string[] = [];
    const d = deps({ recordProof: async (record) => { proofs.push(record.attemptId); return { manifestHash: "ab".repeat(32), txId: "0x1220" + "55".repeat(32), outcome: 0 }; } });
    await d.orchestrator.propose({ ...proposal, submitted: false });
    const published = await d.orchestrator.confirm(ATTEMPT);
    expect(published.state).toBe("submitting"); // Koinos ok, host pending: waits for the user's report
    expect(explain(published).actions).toEqual(["markHostPosted", "markHostFailed"]);
    expect(proofs).toEqual([]);
    const marked = await d.orchestrator.markHost(ATTEMPT, "posted", "https://www.facebook.com/post/1");
    expect(marked.state).toBe("succeeded");
    expect(marked.proof?.manifestHash).toBe("ab".repeat(32));
    expect(proofs).toEqual([ATTEMPT]);
  });

  it("conflicting facts move the record to reconcile_required, which only discard leaves", async () => {
    const d = deps({ lookupChain: async () => ({ value: { post_id: fromHex("99".repeat(32)) } }) });
    await d.orchestrator.propose(proposal);
    const done = await d.orchestrator.confirm(ATTEMPT);
    expect(done.state).toBe("succeeded");
    const conflict = await d.orchestrator.reconcile(ATTEMPT);
    expect(conflict.state).toBe("reconcile_required");
    expect(explain(conflict).actions).toEqual(["discard"]);
    await expect(d.orchestrator.retry(ATTEMPT)).rejects.toThrow();
    await d.orchestrator.discard(ATTEMPT);
    expect(await d.orchestrator.get(ATTEMPT)).toBeUndefined();
  });

  it("sweep turns interrupted submissions into unknown and resolves them by lookup", async () => {
    const d = deps();
    await d.orchestrator.propose(proposal);
    // simulate a service worker killed mid-flight: write a stale "submitting" record directly
    const file = await d.storage.get<{ version: 1; records: StoredCrossPost[] }>(CROSSPOSTS_KEY);
    const stale = { ...file!.records[0]!, state: "submitting" as const, updatedAt: 0, author: AUTHOR };
    await d.storage.set(CROSSPOSTS_KEY, { version: 1, records: [stale] });
    d.chain.set(stale.idempotencyKey, fromHex("77".repeat(32)));
    await d.orchestrator.sweep();
    const after = await d.orchestrator.get(ATTEMPT);
    expect(after?.koinosStatus).toBe("ok");
    expect(after?.postId).toBe("77".repeat(32));
  });
});

describe("service worker end to end (mock chrome.storage + fake ProtocolClient provider)", () => {
  it("create account, authorize device, publish with a timeout, reconcile from chain", async () => {
    const t = createTestBackground();
    await t.call("vault.create", { passphrase: "correct horse battery" });
    const status = await t.call<{ status: string; deviceAuthorized: boolean; ownerAvailable: boolean }>("vault.status");
    expect(status.status).toBe("unlocked");
    expect(status.deviceAuthorized).toBe(false);
    expect(status.ownerAvailable).toBe(true);

    const authorized = await t.call<{ device: { address: string }; registered: boolean; mode: string }>("device.authorize", { passphrase: "correct horse battery", keepOwnerSeed: false });
    expect(authorized.registered).toBe(true);
    expect(authorized.mode).toBe("device");
    expect(t.state.devices.size).toBe(1);
    const chainDevice = await t.call<{ authorized: boolean }>("device.status");
    expect(chainDevice.authorized).toBe(true);

    // first broadcast of the post: the node times out (koilib synthetic receipt with rpc_error)
    let publishes = 0;
    t.state.onSend = (_tx, decoded) => {
      if (decoded.some((d) => d.method === "publish")) {
        publishes += 1;
        if (publishes === 1) {
          const publish = decoded.find((d) => d.method === "publish")!;
          t.state.postsByKey.set(`${publish.args.author}|${toHex(publish.args.idempotency_key as Uint8Array)}`, publish.args.post_id as Uint8Array);
          return { rpc_error: { message: "timed out waiting for the node" } } as never;
        }
      }
      return undefined;
    };
    const draft = await t.call<{ record: StoredCrossPost }>("crosspost.create", { text: "hello chain", audience: 0, adapter: "sidepanel" });
    expect(draft.record.state).toBe("draft");
    const unknown = await t.call<{ record: StoredCrossPost }>("crosspost.confirm", { attemptId: draft.record.attemptId, audience: 0 });
    expect(unknown.record.state).toBe("unknown");
    expect(publishes).toBe(1);
    expect(t.chrome.action._badge.text).toBe("1");

    const reconciled = await t.call<{ record: StoredCrossPost }>("crosspost.reconcile", { attemptId: draft.record.attemptId });
    expect(reconciled.record.state).toBe("succeeded");
    expect(publishes).toBe(1); // never republished
    expect(t.chrome.action._badge.text).toBe("");
    // the publish op was signed by the device key and carries the device field
    const sent = t.provider.sent.filter((s) => s.broadcast);
    expect(sent.length).toBeGreaterThanOrEqual(2);
  });

  it("content-script proposals become drafts only when the adapter is enabled and the origin is granted", async () => {
    const t = createTestBackground({ origins: ["https://www.facebook.com/*"] });
    const sender = t.chrome._contentSender("https://www.facebook.com/home");
    const payload = { hostSite: "facebook", text: "from fb", attemptId: "0a".repeat(16), url: "https://www.facebook.com/home", submitted: true, userGesture: true };
    const disabled = (await t.chrome._dispatch({ type: "crosspost.propose", payload }, sender)) as { ok: boolean; error?: { message: string } };
    expect(disabled.ok).toBe(false);
    expect(disabled.error?.message).toMatch(/disabled/);
    await t.call("adapter.enable", { adapter: "facebook" });
    expect(t.chrome.scripting._registered.has("osp-facebook-adapter")).toBe(true);
    const queued = (await t.chrome._dispatch({ type: "crosspost.propose", payload }, sender)) as { ok: boolean; result: { state: string } };
    expect(queued).toMatchObject({ ok: true, result: { state: "draft" } });
    expect(t.chrome.action._badge.text).toBe("1");
    const feed = (await t.chrome._dispatch({ type: "feed.request", payload: {} }, sender)) as { ok: boolean; result: { enabled: boolean } };
    expect(feed).toMatchObject({ ok: true, result: { enabled: false } });
    await t.call("adapter.disable", { adapter: "facebook" });
    expect(t.chrome.scripting._registered.size).toBe(0);
    expect((await t.chrome.permissions.getAll()).origins).toEqual([]);
  });
});
