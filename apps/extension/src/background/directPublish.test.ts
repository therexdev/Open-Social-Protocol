import { describe, expect, it } from "vitest";
import { createTestBackground } from "../test/support";
import type { FeedPage, PublishReply, Reply, StoredCrossPost } from "../shared/protocol";

const passphrase = "correct horse battery";
async function setup() {
  const t = createTestBackground({ indexer: true, origins: ["https://www.facebook.com/*"] });
  await t.call("vault.create", { passphrase });
  await t.call("device.authorize", { passphrase, keepOwnerSeed: false });
  await t.call("adapter.enable", { adapter: "facebook" });
  return t;
}
const payload = { hostSite: "facebook", text: "Direct friend post", audience: 1, attemptId: "df".repeat(16), url: "https://www.facebook.com/", submitted: true, userGesture: true };

describe("direct audience-selected publication", () => {
  it("publishes encrypted Friends content from one Post action and deduplicates concurrent delivery", async () => {
    const t = await setup();
    const send = () => t.chrome._dispatch({ type: "crosspost.publish", payload }, t.chrome._contentSender(payload.url)) as Promise<Reply<PublishReply>>;
    const results = await Promise.all([send(), send()]);
    for (const result of results) expect(result).toMatchObject({ ok: true, result: { status: "published", message: "Published to Open Social · Friends" } });
    expect(t.state.posts).toHaveLength(1);
    expect(t.state.posts[0]!.audience).toBe(1);
    expect(JSON.stringify(t.state.posts)).not.toContain(payload.text);
    const feed = await t.call<FeedPage>("feed.get", { scope: "friends" });
    expect(feed.items[0]).toMatchObject({ status: "decrypted", text: payload.text });
    const records = await t.background.crossposts.list();
    expect(records[0]).toMatchObject({ state: "succeeded", hostStatus: "not_required", koinosStatus: "ok" });
    expect(records[0]!.text).toBeUndefined();
    expect(t.chrome.action._badge.text).toBe("");
  });
  it("publishes Public directly from the panel with no separate create/confirm round trip", async () => {
    const t = await setup();
    const draft = { text: "Public panel post", audience: 0, adapter: "sidepanel", attemptId: "ed".repeat(16) };
    const result = await t.call<{ record: StoredCrossPost }>("post.publish", draft);
    expect(result.record.koinosStatus).toBe("ok");
    await t.call("post.publish", draft);
    expect(t.state.posts).toHaveLength(1);
    const feed = await t.call<FeedPage>("feed.get", { scope: "public" });
    expect(feed.items[0]).toMatchObject({ status: "plain", text: draft.text });
  });
  it("keeps a refused post recoverable and retries the same attempt after sponsor recovery", async () => {
    const t = await setup();
    const publicDraft = { ...payload, audience: 0 };
    const send = () => t.chrome._dispatch({ type: "crosspost.publish", payload: publicDraft }, t.chrome._contentSender(payload.url)) as Promise<Reply<PublishReply>>;
    t.sponsor.refuse = { status: 403, category: "policy_rejected", message: "temporary refusal" };
    expect(await send()).toMatchObject({ ok: true, result: { status: "failed" } });
    const failed = (await t.background.crossposts.list())[0]!;
    expect(failed.text).toBe(payload.text);
    expect(t.state.posts).toHaveLength(0);
    t.sponsor.refuse = undefined;
    expect(await send()).toMatchObject({ ok: true, result: { status: "published" } });
    const done = (await t.background.crossposts.list())[0]!;
    expect(done.idempotencyKey).toBe(failed.idempotencyKey);
    expect(t.state.posts).toHaveLength(1);
  });
  it("rejects missing gestures, invalid audiences, forged page origins, embedded cards and locked sessions", async () => {
    const t = await setup();
    const sender = t.chrome._contentSender(payload.url);
    const send = (value: unknown, who = sender) => t.chrome._dispatch({ type: "crosspost.publish", payload: value }, who) as Promise<Reply>;
    for (const invalid of [{ ...payload, userGesture: false }, { ...payload, submitted: false }, { ...payload, audience: 99 }, { ...payload, url: "https://www.facebook.com.evil/" }]) expect((await send(invalid)).ok).toBe(false);
    const frame = { ...t.chrome._extensionSender("src/embed/index.html"), frameId: 2, tab: sender.tab };
    expect((await send(payload, frame)).ok).toBe(false);
    await t.call("vault.lock");
    expect((await send(payload)).ok).toBe(false);
    expect(await t.background.crossposts.list()).toHaveLength(0);
    expect(t.state.posts).toHaveLength(0);
  });
});
