import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { ProtocolClient, contentHash, musicChunks, toBase64url, type MusicRecord } from "@osp/sdk";
import { testDeployment } from "./testing/fake-chain.js";
import { loadConfig } from "./config.js";
import { MusicMirror, registerMusicMirror } from "./musicMirror.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
async function fixture(maxBytes = 2 * 1024 * 1024) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "osp-mirror-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const deployment = testDeployment();
  const client = new ProtocolClient({ deployment });
  const bytes = new Uint8Array(300000).fill(37), chunks = musicChunks(bytes);
  const id = toBase64url(new Uint8Array(32).fill(5)), digest = toBase64url(contentHash(bytes));
  const record: MusicRecord = { owner: "owner", payer: "payer", recipient: "recipient", fee: "0", title: "Song", mime: "audio/mpeg", duration_ms: 1000, size: bytes.length, digest: contentHash(bytes), chunk_hashes: chunks.map(contentHash), received: chunks.length, encrypted: true };
  vi.spyOn(client.provider, "getChainId").mockResolvedValue(deployment.chainId);
  vi.spyOn(client.reads.publications, "get_music").mockResolvedValue({ value: record });
  vi.spyOn(client.reads.publications, "get_music_config").mockResolvedValue({ value: { version: 3 } } as never);
  vi.spyOn(client.reads.publications, "get_music_chunks").mockImplementation(async args => ({ chunks: chunks.slice(args!.index, args!.index + args!.count) }));
  vi.spyOn(client.reads.publications, "get_music_chunk").mockImplementation(async args => ({ data: chunks[args!.index]! }));
  const config = loadConfig({}, { deployment }); config.musicCache = { directory, maxBytes };
  const mirror = new MusicMirror(client, config.musicCache);
  const app = Fastify(); registerMusicMirror(app, config, mirror);
  cleanups.push(() => app.close());
  const url = `/v1/music/${encodeURIComponent(id)}/bytes?digest=${encodeURIComponent(digest)}`;
  return { client, bytes, chunks, id, digest, mirror, app, url, config, record };
}
async function warm(f: Awaited<ReturnType<typeof fixture>>) {
  expect((await f.app.inject(f.url)).statusCode).toBe(202);
  await vi.waitFor(async () => expect(await f.mirror.get(f.id, f.digest)).toBeDefined());
}
it("fills once, serves exact encrypted bytes and byte ranges, and reuses files after restart", async () => {
  const f = await fixture();
  await warm(f);
  const range = await f.app.inject({ url: f.url, headers: { range: "bytes=16384-32767" } });
  expect(range.statusCode).toBe(206);
  expect(range.headers["content-range"]).toBe(`bytes 16384-32767/${f.bytes.length}`);
  expect(range.rawPayload).toEqual(Buffer.from(f.bytes.slice(16384, 32768)));
  expect((await f.app.inject(f.url)).rawPayload).toEqual(Buffer.from(f.bytes));
  expect(f.client.reads.publications.get_music_chunks).toHaveBeenCalledTimes(3);
  await f.mirror.close();
  const restored = new MusicMirror(f.client, f.config.musicCache!);
  cleanups.push(() => restored.close());
  expect(await restored.get(f.id, f.digest)).toMatchObject({ size: f.bytes.length });
  expect(f.client.reads.publications.get_music_chunks).toHaveBeenCalledTimes(3);
});
it("rejects malformed identifiers and invalid ranges", async () => {
  const f = await fixture();
  expect((await f.app.inject("/v1/music/invalid/bytes?digest=x")).statusCode).toBe(400);
  expect((await f.app.inject({ url: f.url, headers: { range: "bytes=1-2,3-4" } })).statusCode).toBe(416);
  expect(f.client.reads.publications.get_music).not.toHaveBeenCalled();
  await warm(f);
  expect((await f.app.inject({ url: f.url, headers: { range: "bytes=999999-" } })).statusCode).toBe(416);
});
it("rejects wrong-chain and corrupt fills, then negatively caches the failure", async () => {
  const f = await fixture();
  vi.mocked(f.client.reads.publications.get_music_chunks).mockResolvedValue({ chunks: [new Uint8Array(16384)] });
  await f.mirror.get(f.id, f.digest);
  await vi.waitFor(() => expect(f.client.reads.publications.get_music_chunks).toHaveBeenCalled());
  await f.mirror.close();
  expect(await f.mirror.get(f.id, f.digest)).toBeUndefined();
  const wrong = new MusicMirror(f.client, f.config.musicCache!); cleanups.push(() => wrong.close());
  vi.mocked(f.client.provider.getChainId).mockResolvedValue("wrong");
  vi.mocked(f.client.reads.publications.get_music).mockClear();
  await wrong.get(f.id, f.digest);
  await wrong.close();
  expect(f.client.reads.publications.get_music).not.toHaveBeenCalled();
});
it("bounds simultaneous cold fills and deduplicates requests", async () => {
  const f = await fixture();
  let release!: () => void;
  vi.mocked(f.client.provider.getChainId).mockImplementation(() => new Promise(resolve => { release = () => resolve(f.client.chainId); }));
  await Promise.all(Array.from({ length: 20 }, () => f.mirror.get(f.id, f.digest)));
  expect(f.client.provider.getChainId).toHaveBeenCalledTimes(1);
  release();
  await vi.waitFor(async () => expect(await f.mirror.get(f.id, f.digest)).toBeDefined());
});
it("evicts old files to enforce the disk cap and detects corruption after restart", async () => {
  const f = await fixture(400000); await warm(f);
  const first = (await f.mirror.get(f.id, f.digest))!;
  const nextId = toBase64url(new Uint8Array(32).fill(6));
  await f.mirror.get(nextId, f.digest);
  await vi.waitFor(async () => expect(await f.mirror.get(nextId, f.digest)).toBeDefined());
  await expect(readFile(first.path)).rejects.toThrow();
  const second = (await f.mirror.get(nextId, f.digest))!;
  await f.mirror.close();
  await writeFile(second.path, new Uint8Array(f.bytes.length));
  const restored = new MusicMirror(f.client, f.config.musicCache!); cleanups.push(() => restored.close());
  expect(await restored.get(nextId, f.digest)).toBeUndefined();
});
it("adapts compute-limited native reads and verifies the final digest", async () => {
  const f = await fixture();
  vi.mocked(f.client.reads.publications.get_music_chunks).mockImplementation(async args => {
    if (args!.count > 2) throw Error("compute bandwidth limit exceeded");
    return { chunks: f.chunks.slice(args!.index, args!.index + args!.count) };
  });
  await warm(f);
  expect((await f.app.inject(f.url)).rawPayload).toEqual(Buffer.from(f.bytes));
});
it("validates configuration and leaves the feature off unless explicitly enabled", () => {
  expect(loadConfig({}).musicCache).toBeUndefined();
  expect(loadConfig({ OSP_MUSIC_CACHE: "true" }).musicCache?.maxBytes).toBe(512 * 1024 * 1024);
  expect(() => loadConfig({ OSP_MUSIC_CACHE: "yes" })).toThrow("true or false");
  expect(() => loadConfig({ OSP_MUSIC_CACHE_MAX_MB: "10000" })).toThrow("4096");
});
