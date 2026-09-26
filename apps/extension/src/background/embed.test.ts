import { describe, expect, it, vi } from "vitest";
import { encodeProfile, toBase64url, fromHex } from "@osp/sdk";
import { createTestBackground } from "../test/support";
import type { FeedItem, FeedRequestReply, StoredCrossPost } from "../shared/protocol";

describe("embedded post boundary", () => {
  it("delivers ids to Facebook, decrypts only in a granted extension frame, and denies vault/signing methods there", async () => {
    const t = createTestBackground({ indexer: true, origins: ["https://www.facebook.com/*"] });
    const passphrase = "correct horse battery";
    const { account } = await t.call<{ account: string }>("vault.create", { passphrase });
    await t.call("device.authorize", { passphrase, keepOwnerSeed: false });
    t.indexer.profiles.set(account, { profileUri: "data:application/x-osp-profile;base64," + toBase64url(encodeProfile({ display_name: "Rex" })) });
    const draft = await t.call<{ record: StoredCrossPost }>("crosspost.create", { text: "A private friend post", audience: 1, adapter: "sidepanel" });
    const done = await t.call<{ record: StoredCrossPost }>("crosspost.confirm", { attemptId: draft.record.attemptId });
    const postId = toBase64url(fromHex(done.record.postId!));
    await t.call("adapter.enable", { adapter: "facebook" });
    await t.call("settings.update", { patch: { feedInsertion: true, feedScope: "friends" } });
    const content = t.chrome._contentSender("https://www.facebook.com/");
    const frame = { ...t.chrome._extensionSender("src/embed/index.html#post=" + postId), frameId: 2, tab: content.tab };
    const dispatch = (type: string, payload: unknown, sender: chrome.runtime.MessageSender = frame) => t.chrome._dispatch({ type, payload }, sender) as Promise<{ ok: boolean; result?: { item?: FeedItem } }>;
    const touch = vi.spyOn(t.background.vault, "touch");
    const refs = await t.chrome._dispatch({ type: "feed.request", payload: {} }, content) as { ok: boolean; result: FeedRequestReply };
    expect(refs.result.items).toEqual([{ postId }]);
    expect(JSON.stringify(refs)).not.toContain("private friend");
    const card = await dispatch("embed.post", { postId });
    expect(card.result?.item).toMatchObject({ status: "decrypted", text: "A private friend post", authorName: "Rex" });
    expect(touch).not.toHaveBeenCalled(); // background polling must not prevent auto-lock
    for (const type of ["vault.export", "vault.status", "crosspost.confirm", "settings.update", "feed.get"]) expect((await dispatch(type, {})).ok).toBe(false);
    expect((await dispatch("embed.post", { postId }, content)).ok).toBe(false);
    expect((await dispatch("embed.post", { postId }, { ...frame, frameId: 0 })).ok).toBe(false);
    expect((await dispatch("embed.post", { postId }, { ...frame, tab: { ...content.tab!, url: "https://example.org/" } })).ok).toBe(false);
    await t.call("vault.lock");
    const locked = await dispatch("embed.post", { postId });
    expect(locked.result?.item).toMatchObject({ status: "locked" });
    expect(locked.result?.item?.text).toBeUndefined();
    await t.call("adapter.disable", { adapter: "facebook" });
    expect((await dispatch("embed.post", { postId })).ok).toBe(false);
  });
});
