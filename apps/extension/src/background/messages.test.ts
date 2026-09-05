import { describe, expect, it, vi } from "vitest";
import { MAX_MESSAGE_BYTES } from "../shared/protocol";
import { bool, obj, str } from "../shared/validate";
import { createRouter, defineHandler, originsFromPatterns, type Handlers } from "./messages";
import { createChromeMock } from "../test/chromeMock";

const ID = "osp-test-extension";

function router(overrides: { origins?: string[]; handlers?: Handlers; now?: () => number } = {}) {
  const chromeMock = createChromeMock({ id: ID, origins: overrides.origins ?? ["https://www.facebook.com/*"] });
  const handlers: Handlers = overrides.handlers ?? {
    "vault.status": defineHandler({ source: "extension", validate: (v) => v, handle: async () => ({ status: "empty" }) }),
    "crosspost.propose": defineHandler({
      source: "content",
      requireGesture: true,
      validate: obj({ hostSite: str(), text: str({ max: 3000 }), attemptId: str(), url: str(), submitted: bool(), userGesture: bool() }),
      handle: async (p) => ({ attemptId: p.attemptId }),
    }),
    "feed.request": defineHandler({ source: "content", validate: (v) => v, handle: async () => ({ enabled: false, items: [] }) }),
  };
  const r = createRouter({ runtimeId: ID, handlers, grantedOrigins: async () => (await chromeMock.permissions.getAll()).origins ?? [], now: overrides.now, rateLimit: { max: 3, windowMs: 1000 } });
  return { r, chromeMock };
}

const proposal = { hostSite: "facebook", text: "hello", attemptId: "00".repeat(16), url: "https://www.facebook.com/", submitted: true, userGesture: true };

describe("message router", () => {
  it("accepts a valid extension-page message", async () => {
    const { r, chromeMock } = router();
    const reply = await r.handle({ type: "vault.status" }, chromeMock._extensionSender());
    expect(reply).toEqual({ ok: true, result: { status: "empty" } });
  });

  it("accepts a valid content-script message from a granted origin", async () => {
    const { r, chromeMock } = router();
    const reply = await r.handle({ type: "crosspost.propose", payload: proposal }, chromeMock._contentSender("https://www.facebook.com/home"));
    expect(reply).toEqual({ ok: true, result: { attemptId: proposal.attemptId } });
  });

  it("rejects a wrong sender id", async () => {
    const { r, chromeMock } = router();
    const reply = await r.handle({ type: "vault.status" }, { ...chromeMock._extensionSender(), id: "someone-else" });
    expect(reply).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("rejects content-script messages from a non-granted origin", async () => {
    const { r, chromeMock } = router();
    const reply = await r.handle({ type: "crosspost.propose", payload: proposal }, chromeMock._contentSender("https://evil.example.com/"));
    expect(reply).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const noPermission = router({ origins: [] });
    const reply2 = await noPermission.r.handle({ type: "crosspost.propose", payload: proposal }, noPermission.chromeMock._contentSender("https://www.facebook.com/"));
    expect(reply2).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("rejects privileged types from content scripts, and content types from pages", async () => {
    const { r, chromeMock } = router();
    const reply = await r.handle({ type: "vault.status" }, chromeMock._contentSender("https://www.facebook.com/"));
    expect(reply).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const reply2 = await r.handle({ type: "crosspost.propose", payload: proposal }, chromeMock._extensionSender());
    expect(reply2).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("rejects oversize payloads", async () => {
    const { r, chromeMock } = router();
    const reply = await r.handle({ type: "vault.status", payload: { blob: "x".repeat(MAX_MESSAGE_BYTES) } }, chromeMock._extensionSender());
    expect(reply).toMatchObject({ ok: false, error: { code: "too_large" } });
  });

  it("rejects unknown types, malformed messages and unknown payload keys", async () => {
    const { r, chromeMock } = router();
    expect(await r.handle({ type: "nope" }, chromeMock._extensionSender())).toMatchObject({ ok: false, error: { code: "unknown_type" } });
    expect(await r.handle("hi", chromeMock._extensionSender())).toMatchObject({ ok: false, error: { code: "invalid_message" } });
    expect(await r.handle({ type: "vault.status", extra: 1 }, chromeMock._extensionSender())).toMatchObject({ ok: false, error: { code: "invalid_message" } });
    const bad = await r.handle({ type: "crosspost.propose", payload: { ...proposal, evil: true } }, chromeMock._contentSender("https://www.facebook.com/"));
    expect(bad).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
  });

  it("requires a tab, the top frame and a user gesture for content-script messages", async () => {
    const { r, chromeMock } = router();
    const noTab = { ...chromeMock._contentSender("https://www.facebook.com/"), tab: undefined };
    expect(await r.handle({ type: "crosspost.propose", payload: proposal }, noTab)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const frame = chromeMock._contentSender("https://www.facebook.com/", 7, { frameId: 3 });
    expect(await r.handle({ type: "crosspost.propose", payload: proposal }, frame)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const noGesture = await r.handle({ type: "crosspost.propose", payload: { ...proposal, userGesture: false } }, chromeMock._contentSender("https://www.facebook.com/"));
    expect(noGesture).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("rate limits per tab", async () => {
    let t = 0;
    const { r, chromeMock } = router({ now: () => t });
    const sender = chromeMock._contentSender("https://www.facebook.com/", 9);
    for (let i = 0; i < 3; i++) expect((await r.handle({ type: "feed.request", payload: {} }, sender)).ok).toBe(true);
    expect(await r.handle({ type: "feed.request", payload: {} }, sender)).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect((await r.handle({ type: "feed.request", payload: {} }, chromeMock._contentSender("https://www.facebook.com/", 10))).ok).toBe(true);
    t = 2000;
    expect((await r.handle({ type: "feed.request", payload: {} }, sender)).ok).toBe(true);
  });

  it("turns handler errors into error replies and never throws", async () => {
    const handlers: Handlers = { boom: defineHandler({ source: "extension", validate: (v) => v, handle: async () => { throw new Error("nope"); } }) };
    const { r, chromeMock } = router({ handlers });
    expect(await r.handle({ type: "boom" }, chromeMock._extensionSender())).toMatchObject({ ok: false, error: { message: "nope" } });
    const sendResponse = vi.fn();
    expect(r.listener({ type: "boom" }, chromeMock._extensionSender(), sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
  });

  it("maps host permission patterns to origins", () => {
    expect(originsFromPatterns(["https://www.facebook.com/*", "https://*.example.com/*", "<all_urls>", "http://web.facebook.com/x"])).toEqual(["https://www.facebook.com", "http://web.facebook.com"]);
  });
});
