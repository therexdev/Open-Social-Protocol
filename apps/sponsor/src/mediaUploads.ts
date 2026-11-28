/** Resumable browser uploads. Each HTTP body is at most 8 MiB, including when
 * Cloudflare proxies the sponsor. Temporary files keep VPS RAM bounded. */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rm, stat, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { HOSTED_FILE_MAX_BYTES, MEDIA_UPLOAD_PART_BYTES, fromBase64url, utf8Decode, isAddress, verifyMediaUpload, type MediaUploadStatement } from "@osp/sdk";
import type { MediaRoutesOptions } from "./media.js";
import { SponsorRefusal } from "./validate.js";

type Proof = MediaUploadStatement & { signature: string };
type Upload = { id: string; token: string; account: string; hash: string; size: number; received: number; expires: number; completed: number };
type Receipt = { url: string; hash: string; size: number };
const refusal = (message: string) => new SponsorRefusal("invalid_signature", message);

export async function registerMediaUploads(app: FastifyInstance, db: DatabaseSync, options: MediaRoutesOptions,
  putFile: (path: string, hash: string, size: number) => Promise<string>): Promise<() => Promise<void>> {
  const config = options.config!, now = options.now ?? Date.now;
  const maximum = config.maxUploadBytes ?? HOSTED_FILE_MAX_BYTES;
  const temporary = options.dbPath === ":memory:";
  const directory = temporary ? join(tmpdir(), `osp-uploads-${randomBytes(16).toString("hex")}`) : `${options.dbPath}.uploads`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  db.exec("CREATE TABLE IF NOT EXISTS media_uploads (id TEXT PRIMARY KEY, token TEXT NOT NULL, account TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, received INTEGER NOT NULL, expires INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0, UNIQUE(account,hash))");
  const busy = new Set<string>(), finishing = new Map<string, Promise<void>>(), errors = new Map<string, string>(); let active = 0, completing = 0;
  app.addHook("onRequest", async (request, reply) => { if (request.url.startsWith("/v1/media/uploads")) reply.header("Cache-Control", "no-store"); });
  const file = (id: string) => join(directory, id);
  const clean = async () => {
    const expired = db.prepare("SELECT id FROM media_uploads WHERE expires < ?").all(now()) as Array<{ id: string }>;
    for (const row of expired) if (!busy.has(row.id)) {
      await rm(file(row.id), { force: true }); db.prepare("DELETE FROM media_uploads WHERE id=?").run(row.id);
    }
  };
  const proof = (request: FastifyRequest): Proof => {
    const raw = request.headers["x-osp-media-proof"];
    if (typeof raw !== "string" || raw.length > 4096) throw refusal("A signed upload request is required.");
    let p: Proof;
    try { p = JSON.parse(utf8Decode(fromBase64url(raw))); } catch { throw refusal("Invalid upload proof."); }
    if (!p || typeof p.account !== "string" || typeof p.signer !== "string" || !isAddress(p.account) || !isAddress(p.signer) || p.chainId !== options.chainId || p.contract !== options.contract || p.endpoint !== options.endpoint ||
      p.mime !== "application/octet-stream" || typeof p.hash !== "string" || !/^[A-Za-z0-9_-]{43}=$/.test(p.hash) ||
      !Number.isSafeInteger(p.size) || p.size < 1 || p.size > maximum || !Number.isSafeInteger(p.expires) || p.expires < now() || p.expires > now() + 300_000 ||
      typeof p.signature !== "string" || p.signature.length > 100 || !verifyMediaUpload(p, p.signature)) throw refusal("Upload authorization is invalid or expired.");
    return p;
  };
  const authorize = async (p: Proof) => {
    let owner: string | undefined, device = false;
    try {
      owner = await options.ownerOf(p.account);
      if (owner && owner !== p.signer && options.authorizedDevice) device = await options.authorizedDevice(p.account, p.signer);
    } catch { throw new SponsorRefusal("temporarily_unavailable", "Your upload authority could not be verified. Try again shortly."); }
    if (!owner || (owner !== p.signer && !device)) throw refusal("Upload must be signed by the account's current owner or authorized browser.");
  };
  const get = (request: FastifyRequest) => {
    const id = (request.params as { id: string }).id;
    if (!/^[a-f0-9]{32}$/.test(id)) throw refusal("Invalid upload session.");
    const upload = db.prepare("SELECT * FROM media_uploads WHERE id=?").get(id) as Upload | undefined;
    if (!upload || upload.expires < now() || request.headers["x-osp-upload-token"] !== upload.token) throw refusal("This upload session has expired. Select the file again to resume.");
    return upload;
  };
  const reserve = (p: Proof) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const day = new Date(now()).toISOString().slice(0, 10);
      const total = db.prepare("SELECT COALESCE(SUM(files),0) AS files, COALESCE(SUM(bytes),0) AS bytes FROM media_attempts").get() as { files: number; bytes: number };
      const daily = db.prepare("SELECT files FROM media_attempts WHERE account=? AND day=?").get(p.account, day) as { files: number } | undefined;
      const pending = db.prepare("SELECT COUNT(*) AS count FROM media_uploads WHERE completed=0").get() as { count: number };
      if (pending.count >= 16) throw new SponsorRefusal("temporarily_unavailable", "Uploads are busy. Please try again shortly.");
      if ((daily?.files ?? 0) >= config.dailyFiles || total.files >= config.maxFiles || total.bytes + p.size > config.maxBytes)
        throw new SponsorRefusal("quota_exceeded", "This hosting service's upload allowance is full. Try later or choose another hosting service.");
      db.prepare("INSERT INTO media_attempts VALUES (?,?,1,?) ON CONFLICT(account,day) DO UPDATE SET files=files+1,bytes=bytes+excluded.bytes").run(p.account, day, p.size);
      const upload: Upload = { id: randomBytes(16).toString("hex"), token: randomBytes(32).toString("hex"), account: p.account, hash: p.hash, size: p.size, received: 0, expires: now() + 86_400_000, completed: 0 };
      db.prepare("INSERT INTO media_uploads VALUES (?,?,?,?,?,?,?,0)").run(upload.id, upload.token, upload.account, upload.hash, upload.size, 0, upload.expires);
      db.exec("COMMIT"); return upload;
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  app.post("/v1/media/uploads", { bodyLimit: 1024 }, async request => {
    const p = proof(request); await authorize(p); await clean();
    const previous = db.prepare("SELECT cid,size FROM media_files WHERE hash=?").get(p.hash) as { cid: string; size: number } | undefined;
    if (previous && previous.size === p.size && previous.cid.startsWith(`${config.r2!.publicUrl}/osp/`)) return { receipt: { url: previous.cid, hash: p.hash, size: previous.size } };
    let upload = db.prepare("SELECT * FROM media_uploads WHERE account=? AND hash=?").get(p.account, p.hash) as Upload | undefined;
    if (!upload) upload = reserve(p);
    if (upload.size !== p.size) throw refusal("The file does not match the upload session.");
    if (busy.has(upload.id)) throw new SponsorRefusal("temporarily_unavailable", "This upload is busy. Retry shortly.");
    busy.add(upload.id);
    try {
      const existing = await stat(file(upload.id)).catch(() => undefined);
      if (!existing || existing.size < upload.received) { await writeFile(file(upload.id), Buffer.alloc(0), { mode: 0o600 }); upload.received = 0; db.prepare("UPDATE media_uploads SET received=0 WHERE id=?").run(upload.id); }
    } finally { busy.delete(upload.id); }
    return { id: upload.id, token: upload.token, received: upload.received, partBytes: MEDIA_UPLOAD_PART_BYTES };
  });
  await app.register(async routes => {
    const release = (request: FastifyRequest) => {
      const held = request as FastifyRequest & { mediaSlot?: boolean };
      if (held.mediaSlot) { held.mediaSlot = false; active--; }
    };
    routes.addHook("onRequestAbort", async request => release(request));
    routes.addHook("onTimeout", async request => release(request));
    routes.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MEDIA_UPLOAD_PART_BYTES }, (_request, body, done) => done(null, body));
    routes.post("/v1/media/uploads/:id/part", {
      bodyLimit: MEDIA_UPLOAD_PART_BYTES,
      onRequest: async request => { get(request); if (active >= 4) throw new SponsorRefusal("temporarily_unavailable", "Uploads are busy. Retry this part shortly."); active++; (request as FastifyRequest & { mediaSlot?: boolean }).mediaSlot = true; },
      onResponse: async request => release(request),
    }, async request => {
      const upload = get(request), offset = Number((request.query as { offset?: string }).offset), body = request.body;
      if (busy.has(upload.id)) throw new SponsorRefusal("temporarily_unavailable", "This upload is already receiving a part. Retry shortly.");
      if (upload.completed || !Number.isSafeInteger(offset) || offset < 0 || !Buffer.isBuffer(body) || !body.length || body.length > MEDIA_UPLOAD_PART_BYTES || offset + body.length > upload.size) throw refusal("Invalid upload part.");
      busy.add(upload.id);
      try {
        const handle = await open(file(upload.id), "r+");
        try {
          if (offset < upload.received && offset + body.length <= upload.received) {
            const old = Buffer.alloc(body.length); const read = await handle.read(old, 0, old.length, offset);
            if (read.bytesRead !== body.length || !old.equals(body)) throw refusal("This part does not match the saved upload.");
            return { received: upload.received };
          }
          if (offset !== upload.received) throw refusal("Resume from the server's saved upload offset.");
          await handle.truncate(upload.received);
          let written = 0;
          while (written < body.length) { const result = await handle.write(body, written, body.length - written, offset + written); if (!result.bytesWritten) throw Error("Upload disk is full."); written += result.bytesWritten; }
          await handle.sync();
          upload.received += body.length;
          db.prepare("UPDATE media_uploads SET received=? WHERE id=?").run(upload.received, upload.id);
          return { received: upload.received };
        } finally { await handle.close(); }
      } finally { busy.delete(upload.id); }
    });
  });
  const receipt = (upload: Upload): Receipt | undefined => {
    const record = db.prepare("SELECT cid,size FROM media_files WHERE hash=?").get(upload.hash) as { cid: string; size: number } | undefined;
    if (record && record.size === upload.size && record.cid.startsWith(`${config.r2!.publicUrl}/osp/`)) return { url: record.cid, hash: upload.hash, size: record.size };
  };
  app.get("/v1/media/uploads/:id", async request => {
    const upload = get(request);
    return { received: upload.received, receipt: receipt(upload), processing: finishing.has(upload.id), error: errors.get(upload.id) };
  });
  app.post("/v1/media/uploads/:id/complete", { bodyLimit: 1024 }, async request => {
    const upload = get(request), p = proof(request);
    if (p.account !== upload.account || p.hash !== upload.hash || p.size !== upload.size) throw refusal("The upload proof does not match this file.");
    await authorize(p);
    const previous = receipt(upload); if (previous) return { receipt: previous };
    if (finishing.has(upload.id)) return { processing: true };
    if (busy.has(upload.id) || completing >= 2) throw new SponsorRefusal("temporarily_unavailable", "Storage is finishing another upload. Retry shortly.");
    if (upload.received !== upload.size) throw refusal("Finish sending this file before publishing it.");
    busy.add(upload.id); completing++; errors.delete(upload.id);
    const task = (async () => {
      await truncate(file(upload.id), upload.size);
      const hash = createHash("sha256"); let size = 0;
      for await (const chunk of createReadStream(file(upload.id))) { hash.update(chunk); size += chunk.length; }
      if (size !== upload.size || hash.digest("base64url") + "=" !== upload.hash) {
        db.prepare("UPDATE media_uploads SET received=0 WHERE id=?").run(upload.id); await truncate(file(upload.id), 0);
        throw refusal("The uploaded file does not match its signed fingerprint. Select the original file again.");
      }
      let url: string;
      try { url = await putFile(file(upload.id), upload.hash, size); }
      catch { throw new SponsorRefusal("temporarily_unavailable", "Storage did not confirm this upload. Select the same file to resume; it has not been published."); }
      if (!url.startsWith(`${config.r2!.publicUrl}/osp/`) || !url.endsWith(`/${upload.hash}`)) throw Error("Invalid storage receipt.");
      db.prepare("INSERT OR REPLACE INTO media_files VALUES (?,?,?)").run(upload.hash, url, size);
      db.prepare("UPDATE media_uploads SET completed=1 WHERE id=?").run(upload.id); await rm(file(upload.id), { force: true });
    })().catch(error => { errors.set(upload.id, error instanceof SponsorRefusal ? error.message : "Storage could not finish this upload. Select the same file to resume."); })
      .finally(() => { busy.delete(upload.id); completing--; finishing.delete(upload.id); });
    finishing.set(upload.id, task);
    return { processing: true };
  });
  return async () => { await Promise.allSettled(finishing.values()); if (temporary) await rm(directory, { recursive: true, force: true }); };
}
