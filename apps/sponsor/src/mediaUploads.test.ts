import { afterEach, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentHash, HOSTED_FILE_MAX_BYTES, MEDIA_UPLOAD_PART_BYTES, Signer, signMediaUpload, toBase64url, utf8 } from "@osp/sdk";
import { registerMediaRoutes } from "./media.js";
import { SponsorRefusal } from "./validate.js";

const user = Signer.fromSeed("large-upload-test"), other = Signer.fromSeed("other-uploader");
const endpoint = "https://sponsor.example/v1/media", now = Date.now(), base = "https://media.example";
const apps: FastifyInstance[] = [], folders: string[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function setup(path = ":memory:", pinFile = vi.fn(async (_path: string, hash: string, _size: number) => `${base}/osp/network/identity/${hash}`)) {
  const app = Fastify(), ownerOf = vi.fn().mockResolvedValue(user.getAddress());
  app.setErrorHandler((e, _request, reply) => reply.code(e instanceof SponsorRefusal ? e.status : 500).send({ error: e instanceof Error ? e.message : "error" }));
  await registerMediaRoutes(app, { dbPath: path, endpoint, chainId: "test", contract: "identity", ownerOf, now: () => now, pin: vi.fn(), pinFile,
    config: { provider: "r2", r2: { publicUrl: base, accountId: "a".repeat(32), bucket: "test", accessKeyId: "id", secretAccessKey: "secret" }, dailyFiles: 10, maxFiles: 100, maxBytes: 20 * HOSTED_FILE_MAX_BYTES } });
  apps.push(app); return { app, ownerOf, pinFile };
}
async function proof(bytes: Uint8Array, patch: Record<string, unknown> = {}) {
  const value = { chainId: "test", contract: "identity", endpoint, account: user.getAddress(), signer: user.getAddress(), hash: toBase64url(contentHash(bytes)), size: bytes.length,
    mime: "application/octet-stream", expires: now + 120_000, ...patch };
  return { "x-osp-media-proof": toBase64url(utf8(JSON.stringify({ ...value, signature: await signMediaUpload(value, user) }))) };
}
async function start(app: FastifyInstance, bytes: Uint8Array, patch?: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/media/uploads", headers: await proof(bytes, patch) });
}
const auth = (session: { token: string }) => ({ "x-osp-upload-token": session.token });
async function part(app: FastifyInstance, session: { id: string; token: string }, bytes: Uint8Array, offset = 0) {
  return app.inject({ method: "POST", url: `/v1/media/uploads/${session.id}/part?offset=${offset}`, headers: { ...auth(session), "content-type": "application/octet-stream" }, payload: Buffer.from(bytes) });
}
async function complete(app: FastifyInstance, session: { id: string; token: string }, bytes: Uint8Array) {
  return app.inject({ method: "POST", url: `/v1/media/uploads/${session.id}/complete`, headers: { ...auth(session), ...await proof(bytes) } });
}
async function settled(app: FastifyInstance, session: { id: string; token: string }) {
  for (let i = 0; i < 100; i++) {
    const result = await app.inject({ method: "GET", url: `/v1/media/uploads/${session.id}`, headers: auth(session) });
    const state = result.json(); if (state.receipt || state.error) return state;
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  throw Error("Upload did not settle");
}

it("advertises large uploads and receives more than 25 MiB in bounded resumable parts before issuing a receipt", async () => {
  const bytes = new Uint8Array(26 * 1024 * 1024).fill(73);
  const pinFile = vi.fn(async (path: string, hash: string, size: number) => {
    expect((await readFile(path)).equals(Buffer.from(bytes))).toBe(true); expect(size).toBe(bytes.length);
    return `${base}/osp/network/identity/${hash}`;
  });
  const { app } = await setup(":memory:", pinFile);
  const discovery = (await app.inject("/v1/media")).json();
  expect(discovery.multipart).toEqual({ version: 1, partBytes: MEDIA_UPLOAD_PART_BYTES, maxFileBytes: HOSTED_FILE_MAX_BYTES });
  const session = (await start(app, bytes)).json();
  expect((await part(app, session, bytes.subarray(0, MEDIA_UPLOAD_PART_BYTES))).statusCode).toBe(200);
  expect((await part(app, session, bytes.subarray(0, MEDIA_UPLOAD_PART_BYTES))).json()).toEqual({ received: MEDIA_UPLOAD_PART_BYTES });
  for (let offset = MEDIA_UPLOAD_PART_BYTES; offset < bytes.length; offset += MEDIA_UPLOAD_PART_BYTES)
    expect((await part(app, session, bytes.subarray(offset, offset + MEDIA_UPLOAD_PART_BYTES), offset)).statusCode).toBe(200);
  expect((await complete(app, session, bytes)).json()).toEqual({ processing: true });
  const result = await settled(app, session);
  expect(result.receipt).toEqual({ url: `${base}/osp/network/identity/${toBase64url(contentHash(bytes))}`, hash: toBase64url(contentHash(bytes)), size: bytes.length });
  expect(pinFile).toHaveBeenCalledOnce();
  expect((await start(app, bytes)).json().receipt).toEqual(result.receipt);
  expect((await complete(app, session, bytes)).json().receipt).toEqual(result.receipt);
});

it("retains offsets and reserved quotas across a restart and refuses unauthorized tokens and changed parts", async () => {
  const folder = await mkdtemp(join(tmpdir(), "osp-large-test-")); folders.push(folder); const path = join(folder, "media.sqlite");
  const bytes = utf8("a recording with two parts"), a = await setup(path), session = (await start(a.app, bytes)).json();
  expect((await part(a.app, { ...session, token: "bad" }, bytes)).statusCode).toBe(400);
  expect((await part(a.app, session, bytes.subarray(0, 10))).statusCode).toBe(200);
  expect((await part(a.app, session, utf8("different!"))).statusCode).toBe(400);
  await a.app.close(); apps.splice(apps.indexOf(a.app), 1);
  const b = await setup(path), resumed = (await start(b.app, bytes)).json();
  expect(resumed.id).toBe(session.id); expect(resumed.received).toBe(10);
  expect((await complete(b.app, resumed, bytes)).statusCode).toBe(400);
  expect((await part(b.app, resumed, bytes.subarray(10), 10)).statusCode).toBe(200);
  await complete(b.app, resumed, bytes); expect((await settled(b.app, resumed)).receipt.size).toBe(bytes.length);
});

it("checks whole-file integrity and rechecks current ownership before publishing a storage receipt", async () => {
  const { app, ownerOf, pinFile } = await setup(), original = utf8("original recording"), session = (await start(app, original)).json();
  expect((await part(app, session, new Uint8Array(original.length).fill(1))).statusCode).toBe(200);
  await complete(app, session, original); expect((await settled(app, session)).error).toContain("fingerprint");
  expect(pinFile).not.toHaveBeenCalled();
  const resumed = (await start(app, original)).json(); expect(resumed.received).toBe(0);
  await part(app, resumed, original); ownerOf.mockResolvedValue(other.getAddress());
  expect((await complete(app, resumed, original)).statusCode).toBe(400);
  expect(pinFile).not.toHaveBeenCalled();
});

it("does not accept unsigned, wrong-scope or oversized upload reservations", async () => {
  const { app, ownerOf } = await setup(), bytes = utf8("podcast");
  expect((await app.inject({ method: "POST", url: "/v1/media/uploads" })).statusCode).toBe(400);
  for (const patch of [{ size: HOSTED_FILE_MAX_BYTES + 1 }, { endpoint: "https://wrong.example" }, { chainId: "other" }, { expires: now - 1 }, { signer: other.getAddress() }])
    expect((await start(app, bytes, patch)).statusCode).toBe(400);
  expect(ownerOf).not.toHaveBeenCalled();
});
