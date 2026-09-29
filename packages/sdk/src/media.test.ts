import { afterEach, describe, expect, it, vi } from "vitest";
import { contentHash } from "./ids.js";
import { bytesEqual, utf8 } from "./encoding.js";
import { encryptMedia, wrapMediaKey, unwrapMediaKey, openMedia, fetchIpfsMedia, readMediaResponse } from "./media.js";

const cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqw4j4k2pm";
afterEach(() => vi.useRealTimers());
describe("portable encrypted photos", () => {
  it("uses fresh keys/nonces, authenticates the file and binds wrapped keys to the ciphertext", () => {
    const source = utf8("private photo bytes"), a = encryptMedia(source), b = encryptMedia(source), postKey = new Uint8Array(32).fill(42);
    expect(bytesEqual(a.ciphertext,b.ciphertext)).toBe(false);
    expect(bytesEqual(a.key,b.key)).toBe(false);
    const wrapped = wrapMediaKey(a.key,postKey,a.contentHash);
    const key = unwrapMediaKey(wrapped,postKey,a.contentHash);
    expect(openMedia(a.ciphertext,a.contentHash,{ key,nonce: a.nonce })).toEqual(source);
    expect(() => unwrapMediaKey(wrapped,postKey,b.contentHash)).toThrow();
    expect(() => unwrapMediaKey(wrapped,new Uint8Array(32),a.contentHash)).toThrow();
    expect(() => openMedia(b.ciphertext,a.contentHash,{ key,nonce: a.nonce })).toThrow(/fingerprint/);
    expect(() => openMedia(a.ciphertext,a.contentHash,{ key: b.key,nonce: a.nonce })).toThrow();
  });
  it("falls back after a gateway serves altered bytes and never accepts a different fingerprint", async () => {
    const source = utf8("photo"), fetchFn = vi.fn().mockResolvedValueOnce(new Response("changed")).mockResolvedValueOnce(new Response(new Uint8Array(source)));
    const result = await fetchIpfsMedia(`ipfs://${cid}`,contentHash(source),{ gateways: ["https://one.test","https://two.test/ipfs/"],fetch: fetchFn });
    expect(result).toEqual(source);
    expect(fetchFn.mock.calls[1]?.[0]).toBe(`https://two.test/ipfs/${cid}`);
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit",referrerPolicy: "no-referrer",cache: "no-store" });
    await expect(fetchIpfsMedia("ipfs://../../secret",contentHash(source),{ fetch: fetchFn })).rejects.toThrow(/Invalid/);
  });
  it("bounds streaming downloads even without a content-length header", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10)); controller.enqueue(new Uint8Array(10)); },cancel });
    await expect(readMediaResponse(new Response(stream),15)).rejects.toThrow(/too large/);
    expect(cancel).toHaveBeenCalled();
  });
  it("starts a working fallback while the first gateway is stalled, then cancels the loser", async () => {
    vi.useFakeTimers();
    const source = utf8("photo fallback"), signals: AbortSignal[] = [];
    const fetchFn = vi.fn((_url: string, options: RequestInit) => {
      signals.push(options.signal as AbortSignal);
      return signals.length === 1 ? new Promise<Response>(() => {}) : Promise.resolve(new Response(new Uint8Array(source)));
    });
    const result = fetchIpfsMedia(cid, contentHash(source), { gateways: ["https://slow.test", "https://working.test"], fetch: fetchFn as typeof fetch });
    await vi.advanceTimersByTimeAsync(750);
    expect(await result).toEqual(source);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(signals[0]!.aborted).toBe(true);
  });
  it("finishes with a retryable error even when fetch ignores cancellation", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
    const result = expect(fetchIpfsMedia(cid, contentHash(utf8("x")), { fetch: fetchFn })).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(18_000); await result;
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
  it("times out and cancels a response body that never finishes", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const result = expect(fetchIpfsMedia(cid, contentHash(utf8("x")), { gateways: ["https://stalled.test"], fetch: fetchFn })).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(18_000); await result;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels promptly on unmount instead of launching more gateways", async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
    const result = expect(fetchIpfsMedia(cid, contentHash(utf8("x")), { fetch: fetchFn, signal: controller.signal })).rejects.toThrow(/cancelled/);
    controller.abort(); await result; await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
