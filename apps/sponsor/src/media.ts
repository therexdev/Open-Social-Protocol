/** Optional, replaceable IPFS upload adapter. No file keys or plaintext private images arrive here. */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { MAX_IMAGE_BYTES, IMAGE_MIMES, contentHash, toBase64url, fromBase64url, utf8Decode, isAddress, ipfsCid, verifyMediaUpload, type MediaUploadStatement } from "@osp/sdk";
import { SponsorRefusal } from "./validate.js";

export interface MediaConfig {
  provider: "pinata" | "kubo";
  pinataJwt?: string;
  kuboUrl?: string;
  dailyFiles: number;
  maxFiles: number;
  maxBytes: number;
}
export function loadMediaConfig(env: Record<string, string | undefined>): MediaConfig | undefined {
  const provider = env.OSP_MEDIA_PROVIDER?.trim();
  if (!provider) return undefined;
  if (provider !== "pinata" && provider !== "kubo") throw new Error("OSP_MEDIA_PROVIDER must be pinata or kubo");
  const positive = (key: string, fallback: number) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${key} must be a positive integer`);
    return n;
  };
  // Prefer a permission-restricted file so the JWT never enters PM2's environment dump.
  const pinataJwt = env.OSP_MEDIA_PINATA_JWT_FILE ? readFileSync(env.OSP_MEDIA_PINATA_JWT_FILE, "utf8").trim() : env.OSP_MEDIA_PINATA_JWT?.trim();
  if (provider === "pinata" && !pinataJwt) throw new Error("Set OSP_MEDIA_PINATA_JWT_FILE to your Pinata JWT file");
  const kuboUrl = env.OSP_MEDIA_KUBO_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:5001";
  if (provider === "kubo" && !/^https?:$/.test(new URL(kuboUrl).protocol)) throw new Error("Invalid OSP_MEDIA_KUBO_URL");
  return { provider, pinataJwt, kuboUrl, dailyFiles: positive("OSP_MEDIA_DAILY_FILES", 10), maxFiles: positive("OSP_MEDIA_MAX_FILES", 450), maxBytes: positive("OSP_MEDIA_MAX_BYTES", 900_000_000) };
}

/** Pinata public IPFS or the operator's own Kubo node; both return the same portable address. */
export async function pinMedia(config: MediaConfig, bytes: Uint8Array, mime: string, hash: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `osp-${hash.replace(/=/g, "")}`);
  if (config.provider === "pinata") form.append("network", "public");
  const response = await fetchFn(config.provider === "pinata" ? "https://uploads.pinata.cloud/v3/files" : `${config.kuboUrl}/api/v0/add?pin=true&cid-version=1`, {
    method: "POST", body: form, signal: AbortSignal.timeout(45_000),
    ...(config.provider === "pinata" && { headers: { Authorization: `Bearer ${config.pinataJwt}` } }),
  });
  // Do not propagate provider error bodies: they may contain credentials or account details.
  if (!response.ok) throw new Error(`Storage provider returned ${response.status}`);
  const data = await response.json() as { data?: { cid?: string }; Hash?: string };
  return ipfsCid((config.provider === "pinata" ? data.data?.cid : data.Hash) ?? "");
}

interface Row { cid: string; size: number }
export interface MediaRoutesOptions {
  config?: MediaConfig;
  dbPath: string;
  endpoint: string;
  chainId: string;
  contract: string;
  ownerOf: (account: string) => Promise<string | undefined>;
  pin?: (bytes: Uint8Array, mime: string, hash: string) => Promise<string>;
  now?: () => number;
}
export async function registerMediaRoutes(app: FastifyInstance, options: MediaRoutesOptions): Promise<void> {
  const { config } = options;
  app.get("/v1/media", async () => ({ version: 1, enabled: !!config, provider: config?.provider ?? null,
    maxFileBytes: MAX_IMAGE_BYTES, dailyFiles: config?.dailyFiles ?? 0,
    retention: "best-effort", message: config ? "IPFS storage has limited capacity; permanent availability is not guaranteed." : "Photo uploads are not configured on this service yet." }));
  if (!config) return;
  if (options.dbPath !== ":memory:") mkdirSync(dirname(options.dbPath), { recursive: true });
  const db = new DatabaseSync(options.dbPath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS media_files (hash TEXT PRIMARY KEY, cid TEXT NOT NULL, size INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS media_attempts (account TEXT NOT NULL, day TEXT NOT NULL, files INTEGER NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(account,day));`);
  const now = options.now ?? Date.now, inFlight = new Map<string, Promise<{ url: string; hash: string; size: number }>>();
  let active = 0;
  await app.register(async routes => {
    routes.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES }, (_req, body, done) => done(null, body));
    routes.post("/v1/media", { bodyLimit: MAX_IMAGE_BYTES }, async request => {
      if (active >= 4) throw new SponsorRefusal("temporarily_unavailable", "Photo uploads are busy. Please try again shortly.");
      const header = request.headers["x-osp-media-proof"];
      if (typeof header !== "string" || header.length > 4096) throw new SponsorRefusal("invalid_signature", "A signed upload request is required");
      let proof: MediaUploadStatement & { signature: string };
      try { proof = JSON.parse(utf8Decode(fromBase64url(header))) as typeof proof; } catch { throw new SponsorRefusal("invalid_signature", "Invalid upload proof"); }
      const body = request.body;
      if (!proof || !Buffer.isBuffer(body) || !body.length || typeof proof.account !== "string" || typeof proof.signer !== "string" || !Number.isSafeInteger(proof.expires) || proof.expires < now() || proof.expires > now() + 300_000 ||
        proof.chainId !== options.chainId || proof.contract !== options.contract || proof.endpoint !== options.endpoint || !isAddress(proof.account) || !isAddress(proof.signer) ||
        proof.size !== body.length || typeof proof.signature !== "string" || proof.signature.length > 100 ||
        ![...IMAGE_MIMES, "application/octet-stream"].includes(proof.mime as typeof IMAGE_MIMES[number]) || proof.hash !== toBase64url(contentHash(body)) ||
        !verifyMediaUpload(proof, proof.signature)) throw new SponsorRefusal("invalid_signature", "Upload authorization is invalid or expired");
      active++;
      try {
        let owner: string | undefined;
        try { owner = await options.ownerOf(proof.account); } catch { throw new SponsorRefusal("temporarily_unavailable", "Your account could not be verified. Try uploading again."); }
        if (!owner || owner !== proof.signer) throw new SponsorRefusal("invalid_signature", "Upload must be signed by the registered account's current owner");
        const previous = db.prepare("SELECT cid,size FROM media_files WHERE hash=?").get(proof.hash) as Row | undefined;
        if (previous) return { url: `ipfs://${previous.cid}`, hash: proof.hash, size: previous.size };
        const pending = inFlight.get(proof.hash);
        if (pending) return await pending;
        // Reserve before contacting storage, including uncertain/failed attempts. This prevents
        // retries or a restart from silently exceeding the operator's free-tier budget.
        db.exec("BEGIN IMMEDIATE");
        try {
          const day = new Date(now()).toISOString().slice(0,10);
          const total = db.prepare("SELECT COALESCE(SUM(files),0) AS files, COALESCE(SUM(bytes),0) AS bytes FROM media_attempts").get() as { files: number; bytes: number };
          const daily = db.prepare("SELECT files FROM media_attempts WHERE account=? AND day=?").get(proof.account,day) as { files: number } | undefined;
          if ((daily?.files ?? 0) >= config.dailyFiles) throw new SponsorRefusal("quota_exceeded", "Your free photo upload allowance is used for today. Try tomorrow or choose another upload service in Settings.");
          if (total.files >= config.maxFiles || total.bytes + body.length > config.maxBytes) throw new SponsorRefusal("quota_exceeded", "This free storage service is full. Choose another upload service in Settings.");
          db.prepare("INSERT INTO media_attempts VALUES (?,?,1,?) ON CONFLICT(account,day) DO UPDATE SET files=files+1,bytes=bytes+excluded.bytes").run(proof.account,day,body.length);
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        const upload = (async () => {
          let cid: string;
          try { cid = ipfsCid(await (options.pin ?? ((bytes,mime,hash) => pinMedia(config,bytes,mime,hash)))(body,proof.mime,proof.hash)); }
          catch { throw new SponsorRefusal("temporarily_unavailable", "The image storage provider did not confirm the upload. Your post has not been published. Please try again."); }
          db.prepare("INSERT OR REPLACE INTO media_files VALUES (?,?,?)").run(proof.hash,cid,body.length);
          return { url: `ipfs://${cid}`, hash: proof.hash, size: body.length };
        })();
        inFlight.set(proof.hash,upload);
        try { return await upload; } finally { inFlight.delete(proof.hash); }
      } finally { active--; }
    });
  });
  app.addHook("onClose", async () => { await Promise.allSettled(inFlight.values()); db.close(); });
}
