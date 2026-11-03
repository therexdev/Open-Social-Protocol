import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, lstat, readFile, writeFile, rename, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  ProtocolClient, Provider, fromBase64url, toBase64url, contentHash, bytesEqual,
  MUSIC_CHUNK_BYTES, MUSIC_MAX_BYTES, MUSIC_READ_BATCH_CHUNKS, musicConfig, verifyMusic,
} from "@osp/sdk";
import type { IndexerConfig } from "./config.js";

export interface MusicMirrorConfig { directory: string; maxBytes: number }
type Entry = { path: string; size: number; used: number; verified: boolean };
const digestHex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const validId = (value: string) => /^[A-Za-z0-9_-]{43}=$/.test(value) && toBase64url(fromBase64url(value)) === value;

/** Abort stalled RPC transports so a dead endpoint cannot occupy a fill slot forever. */
function mirrorClient(config: IndexerConfig) {
  const provider = new Provider(config.rpc);
  provider.call = async <T>(method: string, params: unknown): Promise<T> => {
    if (!["chain.get_chain_id", "chain.read_contract"].includes(method)) throw Error("mirror is read-only");
    let failure: unknown = Error("no RPC configured");
    for (const url of config.rpc) {
      try {
        const response = await fetch(url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw Error(`RPC HTTP ${response.status}`);
        const body = await response.json() as { result?: T; error?: unknown };
        if (body.error) throw Error(JSON.stringify(body.error));
        if (!body.result) throw Error("empty RPC result");
        return body.result;
      } catch (error) {
        if (error instanceof Error && /compute bandwidth limit exceeded/i.test(error.message)) throw error;
        failure = error;
      }
    }
    throw failure;
  };
  return new ProtocolClient({ deployment: config.deployment!, rpc: provider });
}

/** Disposable, bounded mirror of original chain bytes. It never receives decryption keys.
 * A cold miss starts a bounded background fill and returns immediately, letting clients
 * use the chain. No reindex or new database schema is required. */
export class MusicMirror {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<void>>();
  private failed = new Map<string, number>();
  private starts: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private checks = new Map<string, Promise<void>>();
  private closed = false;
  private readonly directory: string;
  private readonly ready: Promise<void>;
  constructor(readonly client: ProtocolClient, readonly config: MusicMirrorConfig) {
    const scope = digestHex(new TextEncoder().encode(JSON.stringify([client.chainId, client.deployment.contracts.publications.address])));
    this.directory = path.join(config.directory, scope);
    this.ready = this.initialize();
    // An unwritable cache must not bring down the indexer or become an unhandled rejection.
    void this.ready.catch(() => undefined);
  }
  private async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.[a-f0-9]{64}\.bin$/.test(name)) {
        if (/^[a-f0-9-]+\.tmp$/.test(name)) await unlink(path.join(this.directory, name)).catch(() => undefined);
        continue;
      }
      const file = path.join(this.directory, name), stat = await lstat(file);
      if (!stat.isFile() || stat.size < 1 || stat.size > MUSIC_MAX_BYTES) { await unlink(file); continue; }
      this.entries.set(name, { path: file, size: stat.size, used: stat.mtimeMs, verified: false });
    }
    await this.prune(0);
  }
  private async prune(extra: number) {
    let total = [...this.entries.values()].reduce((sum, entry) => sum + entry.size, 0);
    for (const [key, entry] of [...this.entries].sort((a, b) => a[1].used - b[1].used)) {
      if (total + extra <= this.config.maxBytes) break;
      await unlink(entry.path).catch(() => undefined);
      total -= entry.size;
      this.entries.delete(key);
    }
  }
  async get(id: string, digest: string): Promise<Entry | undefined> {
    if (!validId(id) || !validId(digest)) throw new Error("invalid_music_id");
    await this.ready;
    if (this.closed) return;
    const key = `${Buffer.from(fromBase64url(id)).toString("hex")}.${Buffer.from(fromBase64url(digest)).toString("hex")}.bin`;
    const entry = this.entries.get(key);
    if (entry) {
      try {
        if (!entry.verified) {
          let check = this.checks.get(key);
          if (!check) {
            check = (async () => {
              const data = await readFile(entry.path);
              if (data.length !== entry.size || !bytesEqual(contentHash(data), fromBase64url(digest))) throw Error("cache digest mismatch");
              entry.verified = true;
            })().finally(() => this.checks.delete(key));
            this.checks.set(key, check);
          }
          await check;
        }
        entry.used = Date.now();
        await utimes(entry.path, new Date(), new Date(entry.used));
        return entry;
      } catch { this.entries.delete(key); await unlink(entry.path).catch(() => undefined); }
    }
    if (this.pending.has(key)) return;
    const now = Date.now();
    for (const [failed, until] of this.failed) if (until <= now) this.failed.delete(failed);
    this.starts = this.starts.filter(start => now - start < 60_000);
    if (this.failed.has(key) || this.pending.size >= 2 || this.starts.length >= 10) return;
    this.starts.push(now);
    const task = this.fill(key, id, digest).catch(() => {
      this.failed.set(key, Date.now() + 60_000);
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, task);
    return;
  }
  private async fill(key: string, id: string, digest: string) {
    const deadline = Date.now() + 120_000;
    if (await this.client.provider.getChainId() !== this.client.chainId) throw Error("wrong chain");
    const bytesId = fromBase64url(id);
    const record = (await this.client.reads.publications.get_music({ id: bytesId }))?.value;
    if (!record || record.size < 1 || record.size > Math.min(MUSIC_MAX_BYTES, this.config.maxBytes) ||
      record.received !== record.chunk_hashes.length || record.chunk_hashes.length !== Math.ceil(record.size / MUSIC_CHUNK_BYTES) ||
      toBase64url(record.digest) !== digest) throw Error("track unavailable");
    let batch = (await musicConfig(this.client)).version >= 3 ? MUSIC_READ_BATCH_CHUNKS : 1;
    const chunks = new Array<Uint8Array>(record.chunk_hashes.length);
    let cursor = 0, stopped = false;
    // At most two fills, each with two RPC reads in flight. Keep native reads <= 8.
    const results = await Promise.allSettled(Array.from({ length: 2 }, async () => {
      try {
        while (cursor < chunks.length) {
          let index = cursor;
          const end = Math.min(index + batch, chunks.length);
          cursor = end;
          while (index < end) {
            if (this.closed || stopped || Date.now() > deadline) throw Error("mirror stopped or timed out");
            const count = Math.min(batch, end - index);
            let result: Array<Uint8Array | undefined> | undefined;
            try {
              result = count > 1
                ? (await this.client.reads.publications.get_music_chunks({ id: bytesId, index, count }))?.chunks
                : [(await this.client.reads.publications.get_music_chunk({ id: bytesId, index }))?.data];
            } catch (error) {
              if (count > 1 && error instanceof Error && /compute bandwidth limit exceeded/i.test(error.message)) {
                batch = Math.max(1, Math.min(batch, Math.floor(count / 2))); continue;
              }
              throw error;
            }
            if (!result || result.length !== count) throw Error("missing chunks");
            result.forEach((chunk, offset) => {
              const i = index + offset;
              if (!chunk || chunk.length !== Math.min(MUSIC_CHUNK_BYTES, record.size - i * MUSIC_CHUNK_BYTES) ||
                !bytesEqual(contentHash(chunk), record.chunk_hashes[i]!)) throw Error("invalid chunk");
              chunks[i] = chunk;
            });
            index += count;
          }
        }
      } catch (error) { stopped = true; throw error; }
    }));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    const bytes = verifyMusic(record, chunks);
    const write = this.queue.catch(() => undefined).then(async () => {
      if (this.closed) return;
      await this.prune(bytes.length);
      const temporary = path.join(this.directory, `${randomUUID()}.tmp`), file = path.join(this.directory, key);
      try {
        await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
        await rename(temporary, file);
        this.entries.set(key, { path: file, size: bytes.length, used: Date.now(), verified: true });
      } finally { await unlink(temporary).catch(() => undefined); }
    });
    this.queue = write;
    await write;
  }
  async close() { this.closed = true; await Promise.allSettled([...this.pending.values()]); }
}

export function registerMusicMirror(app: FastifyInstance, config: IndexerConfig, supplied?: MusicMirror) {
  if (!config.musicCache || !config.deployment) return;
  const mirror = supplied ?? new MusicMirror(mirrorClient(config), config.musicCache);
  app.addHook("onClose", async () => mirror.close());
  app.get<{ Params: { id: string }; Querystring: { digest?: string } }>("/v1/music/:id/bytes", async (request, reply) => {
    const { id } = request.params, digest = request.query.digest ?? "";
    if (!validId(id) || !validId(digest)) return reply.code(400).send({ error: "invalid music id or digest" });
    const range = request.headers.range;
    if (range && !/^bytes=\d+-\d*$/.test(range)) return reply.code(416).send({ error: "use one byte range" });
    let entry: Entry | undefined;
    try { entry = await mirror.get(id, digest); }
    catch { return reply.code(503).header("Cache-Control", "no-store").send({ error: "music cache unavailable; use chain" }); }
    if (!entry) return reply.code(202).header("Retry-After", "5").header("Cache-Control", "no-store").send({ status: "warming", fallback: "chain" });
    let start = 0, end = entry.size - 1;
    if (range) {
      const parts = range.slice(6).split("-");
      start = Number(parts[0]); end = parts[1] ? Math.min(Number(parts[1]), end) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
        return reply.code(416).header("Content-Range", `bytes */${entry.size}`).send();
      }
      reply.code(206).header("Content-Range", `bytes ${start}-${end}/${entry.size}`);
    }
    return reply.header("Content-Type", "application/octet-stream").header("Content-Length", end - start + 1)
      .header("Accept-Ranges", "bytes").header("ETag", `"${digest}"`)
      .header("Cache-Control", "public, max-age=3600, immutable")
      .send(createReadStream(entry.path, { start, end }));
  });
}
