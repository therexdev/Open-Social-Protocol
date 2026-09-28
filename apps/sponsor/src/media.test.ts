import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Signer, signMediaUpload, toBase64url, contentHash, utf8, type MediaUploadStatement } from "@osp/sdk";
import { loadMediaConfig, pinMedia, registerMediaRoutes, type MediaConfig } from "./media.js";
import { SponsorRefusal } from "./validate.js";

const user = Signer.fromSeed("media-user"), other = Signer.fromSeed("media-other");
const cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqw4j4k2pm";
const endpoint = "https://upload.test/v1/media", now = 1_800_000_000_000;
const config: MediaConfig = { provider: "pinata",pinataJwt: "server-secret",dailyFiles: 2,maxFiles: 3,maxBytes: 1000 };
const apps: FastifyInstance[] = [], dirs: string[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for (const dir of dirs.splice(0)) rmSync(dir,{ recursive: true,force: true }); });
async function setup(options: { path?: string; owner?: string; pin?: ReturnType<typeof vi.fn<(...args: any[]) => Promise<string>>>; config?: MediaConfig } = {}) {
  const app = Fastify(), pin = options.pin ?? vi.fn().mockResolvedValue(cid), ownerOf = vi.fn().mockResolvedValue(options.owner ?? user.getAddress());
  app.setErrorHandler((e,req,reply) => reply.code(e instanceof SponsorRefusal ? e.status : 500).send({ error: e instanceof Error ? e.message : "error" }));
  await registerMediaRoutes(app,{ config: options.config ?? config,dbPath: options.path ?? ":memory:",endpoint,chainId: "test",contract: "identity",ownerOf,pin,now: () => now });
  apps.push(app); return { app,pin,ownerOf };
}
async function headers(bytes: Uint8Array, overrides: Partial<MediaUploadStatement> = {}) {
  const proof: MediaUploadStatement = { account: user.getAddress(),signer: user.getAddress(),chainId: "test",contract: "identity",endpoint,hash: toBase64url(contentHash(bytes)),size: bytes.length,mime: "application/octet-stream",expires: now + 60000,...overrides };
  return { "content-type": "application/octet-stream", "x-osp-media-proof": toBase64url(utf8(JSON.stringify({ ...proof,signature: await signMediaUpload(proof,user) }))) };
}
const upload = async (app: FastifyInstance, bytes: Uint8Array, overrides?: Partial<MediaUploadStatement>) => app.inject({ method: "POST",url: "/v1/media",headers: await headers(bytes,overrides),payload: Buffer.from(bytes) });
describe("IPFS service", () => {
  it("requires a valid scoped proof, matching bytes and the current registered owner", async () => {
    const { app,pin,ownerOf } = await setup(), bytes = utf8("ciphertext");
    for (const patch of [{ endpoint: "https://different.test/v1/media" },{ expires: now - 1 },{ hash: "bad" },{ signer: other.getAddress() }]) expect((await upload(app,bytes,patch)).statusCode).toBe(400);
    expect(ownerOf).not.toHaveBeenCalled();
    expect((await app.inject({ method: "POST",url: "/v1/media",headers: await headers(bytes),payload: Buffer.from("tampered") })).statusCode).toBe(400);
    ownerOf.mockResolvedValueOnce(other.getAddress()); expect((await upload(app,bytes)).statusCode).toBe(400);
    ownerOf.mockResolvedValueOnce(undefined); expect((await upload(app,bytes)).statusCode).toBe(400);
    expect(pin).not.toHaveBeenCalled();
    const result = await upload(app,bytes);
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ url: `ipfs://${cid}`,hash: toBase64url(contentHash(bytes)),size: bytes.length });
    expect(pin).toHaveBeenCalledWith(Buffer.from(bytes),"application/octet-stream",toBase64url(contentHash(bytes)));
  });
  it("deduplicates concurrent retries, persists receipts and keeps quotas across restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(),"osp-media-")); dirs.push(dir); const path = join(dir,"media.sqlite");
    const first = await setup({ path });
    const responses = await Promise.all([upload(first.app,utf8("one")),upload(first.app,utf8("one"))]);
    expect(responses.every(r => r.statusCode === 200)).toBe(true); expect(first.pin).toHaveBeenCalledTimes(1);
    expect((await upload(first.app,utf8("two"))).statusCode).toBe(200);
    await first.app.close(); apps.splice(apps.indexOf(first.app),1);
    const second = await setup({ path });
    expect((await upload(second.app,utf8("one"))).statusCode).toBe(200);
    expect((await upload(second.app,utf8("three"))).statusCode).toBe(429);
    expect(second.pin).not.toHaveBeenCalled();
  });
  it("enforces a total storage cap and never refunds an uncertain provider outcome", async () => {
    const { app,pin } = await setup({ config: { ...config,maxFiles: 1 },pin: vi.fn().mockRejectedValue(new Error("secret provider information")) });
    const failed = await upload(app,utf8("one")); expect(failed.statusCode).toBe(503); expect(failed.body).not.toContain("secret provider");
    expect((await upload(app,utf8("two"))).statusCode).toBe(429); expect(pin).toHaveBeenCalledTimes(1);
  });
  it("provides Pinata and Kubo adapters without uploading private filenames, keys or gateway URLs", async () => {
    const bytes = utf8("ciphertext"), fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { cid } })));
    expect(await pinMedia(config,bytes,"application/octet-stream","digest",fetchFn)).toBe(cid);
    const [url,options] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://uploads.pinata.cloud/v3/files"); expect(options.headers).toEqual({ Authorization: "Bearer server-secret" });
    expect(options.body.get("network")).toBe("public"); expect(options.body.get("file").name).toBe("osp-digest");
    expect(new Uint8Array(await options.body.get("file").arrayBuffer())).toEqual(bytes);
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ Hash: cid })));
    expect(await pinMedia({ ...config,provider: "kubo",kuboUrl: "http://127.0.0.1:5001" },bytes,"application/octet-stream","digest",fetchFn)).toBe(cid);
    expect(fetchFn.mock.calls[1]?.[1].headers).toBeUndefined();
    expect(loadMediaConfig({})).toBeUndefined();
    expect(() => loadMediaConfig({ OSP_MEDIA_PROVIDER: "pinata" })).toThrow(/JWT/);
  });
});
