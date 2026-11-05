import { expect, it } from "vitest";
import { fromHex, toBase64url } from "@osp/sdk";
import { createTestBackground } from "../test/support";

it("cross-posts only a tab/account-bound X draft with its published URL, with durable recovery and duplicate protection", async () => {
  const t = createTestBackground({ indexer: true, sponsor: false, origins: ["https://x.com/*", "https://www.facebook.com/*"] });
  const passphrase = "correct horse battery";
  const { account } = await t.call<{ account: string }>("vault.create", { passphrase });
  await t.call("device.authorize", { passphrase, keepOwnerSeed: true });
  await t.call("settings.update", { patch: { payment: "self-only" } });
  const sender = t.chrome._contentSender("https://x.com/home"), fb = t.chrome._contentSender("https://www.facebook.com/");
  const send = (type: string, payload: unknown, from = sender) => t.background.router.handle({ type, payload }, from);
  const attemptId = "ad".repeat(16), before = t.state.broadcasts.length;
  const payload = { text: "Cross-posted X content", audience: 0, attemptId, url: "https://x.com/home", submitted: true, userGesture: true };
  expect(await send("crosspost.xPrepare", payload)).toMatchObject({ ok: false });
  await t.call("adapter.enable", { adapter: "x" });
  // Disabling the feed must leave composer sharing enabled.
  await t.call("settings.update", { patch: { xFeedInsertion: false, facebookAutoCheck: false, facebookAttribution: false } });
  expect(await send("adapter.preferences", {})).toEqual({ ok: true, result: { xEnabled: true, xAutoCheck: true, xAttribution: true } });
  for (const invalid of [{ userGesture: false }, { submitted: false }, { url: "https://www.facebook.com/" }, { text: "界".repeat(1500) }])
    expect(await send("crosspost.xPrepare", { ...payload, ...invalid })).toMatchObject({ ok: false });
  expect(await send("crosspost.xPrepare", payload, fb)).toMatchObject({ ok: false });
  expect(await send("crosspost.xPrepare", payload)).toMatchObject({ ok: true, result: { awaitingX: true, profileUrl: `https://opensocial.online/u/${account}` } });
  expect(t.state.broadcasts.length).toBe(before);
  await expect(t.call("crosspost.confirm", { attemptId })).rejects.toThrow(/X link/);
  await expect(t.call("crosspost.retry", { attemptId })).rejects.toThrow(/Retry is not available/);
  const url = "https://x.com/Tester/status/123456?s=20";
  expect(await send("crosspost.xComplete", { attemptId, url: "https://x.com/home" })).toMatchObject({ ok: false });
  expect(await send("crosspost.xComplete", { attemptId, url }, { ...sender, tab: { ...sender.tab!, id: 999 } })).toMatchObject({ ok: false });
  expect(await send("crosspost.xComplete", { attemptId, url }, fb)).toMatchObject({ ok: false });
  expect(await send("crosspost.finishX", { attemptId, url })).toMatchObject({ ok: false });
  expect(await send("crosspost.xComplete", { attemptId, url })).toMatchObject({ ok: true, result: { status: "published" } });
  const record = (await t.background.crossposts.get(attemptId))!;
  const card = await t.background.feed.card(toBase64url(fromHex(record.postId!)));
  expect(card).toMatchObject({ text: `${payload.text}\n\nhttps://x.com/tester/status/123456`, externalRef: "https://x.com/tester/status/123456" });
  expect(record.text).toBeUndefined();
  const count = t.state.broadcasts.length;
  expect(await send("crosspost.xComplete", { attemptId, url })).toMatchObject({ ok: true });
  expect(t.state.broadcasts.length).toBe(count);
  expect(await send("crosspost.xComplete", { attemptId, url: "https://x.com/tester/status/999" })).toMatchObject({ ok: false });

  const second = "ce".repeat(16), secondUrl = "https://x.com/tester/status/789";
  await send("crosspost.xPrepare", { ...payload, audience: 1, attemptId: second });
  expect(await send("crosspost.xComplete", { attemptId: second, url: "https://x.com/i/web/status/123456" })).toMatchObject({ ok: false });
  await t.call("vault.lock");
  expect(await send("crosspost.xComplete", { attemptId: second, url: secondUrl })).toMatchObject({ ok: false });
  await t.call("vault.unlock", { passphrase });
  t.now.value += 11 * 60_000;
  expect(await send("crosspost.xComplete", { attemptId: second, url: secondUrl })).toMatchObject({ ok: false });
  await t.call("crosspost.finishX", { attemptId: second, url: secondUrl });
  const privateRecord = (await t.background.crossposts.get(second))!;
  expect(privateRecord).toMatchObject({ koinosStatus: "ok", audience: 1, xPostUrl: secondUrl });
  const privateCard = await t.background.feed.card(toBase64url(fromHex(privateRecord.postId!)));
  expect(privateCard).toMatchObject({ status: "decrypted", text: `${payload.text}\n\n${secondUrl}` });
});
