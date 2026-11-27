/** Optional R2/IPFS upload adapters. Private media arrives already encrypted, without its keys. */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { MAX_IMAGE_BYTES, HOSTED_MEDIA_DEFAULT_MAX_BYTES, HOSTED_MEDIA_MAX_BYTES, MUSIC_MIMES, IMAGE_MIMES, contentHash, toBase64url, fromBase64url, utf8Decode, isAddress, ipfsCid, verifyMediaUpload, type MediaUploadStatement } from "@osp/sdk";
import { createR2Writer, loadR2Config, type R2Config } from "./r2.js";
import { SponsorRefusal } from "./validate.js";

export interface MediaConfig {
  provider: "pinata" | "kubo" | "r2";
  r2?: R2Config;
  pinataJwt?: string;
  kuboUrl?: string;
  dailyFiles: number;
  maxFiles: number;
  maxBytes: number;
  maxFileBytes?: number;
}
export function loadMediaConfig(env: Record<string, string | undefined>): MediaConfig | undefined {
  const provider = env.OSP_MEDIA_PROVIDER?.trim();
  if (!provider) return undefined;
  if (provider !== "pinata" && provider !== "kubo" && provider !== "r2") throw new Error("OSP_MEDIA_PROVIDER must be pinata, kubo or r2");
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
  const maxFileBytes = positive("OSP_MEDIA_MAX_FILE_BYTES", HOSTED_MEDIA_DEFAULT_MAX_BYTES);
  if (maxFileBytes > HOSTED_MEDIA_MAX_BYTES) throw Error("OSP_MEDIA_MAX_FILE_BYTES exceeds the supported hosting limit");
  return { provider, ...(provider === "r2" && { r2: loadR2Config(env) }), pinataJwt, kuboUrl, maxFileBytes, dailyFiles: positive("OSP_MEDIA_DAILY_FILES", 10), maxFiles: positive("OSP_MEDIA_MAX_FILES", 450), maxBytes: positive("OSP_MEDIA_MAX_BYTES", 900_000_000) };
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
  authorizedDevice?: (account: string, signer: string) => Promise<boolean>;
  pin?: (bytes: Uint8Array, mime: string, hash: string) => Promise<string>;
  now?: () => number;
}
export async function registerMediaRoutes(app: FastifyInstance, options: MediaRoutesOptions): Promise<void> {
  const { config } = options;
  const maxFileBytes = config?.provider === "r2" ? config.maxFileBytes ?? HOSTED_MEDIA_DEFAULT_MAX_BYTES : MAX_IMAGE_BYTES;
  const r2 = config?.provider === "r2" && !options.pin ? createR2Writer(config.r2!, options.chainId, options.contract) : undefined;
  const receiptUrl = (value: string) => {
    if (!value.startsWith("https://")) return `ipfs://${ipfsCid(value)}`;
    if (config?.provider !== "r2" || !config.r2 || !value.startsWith(`${config.r2.publicUrl}/osp/`)) throw Error("Invalid storage receipt");
    return value;
  };
  app.get("/v1/media", async () => ({ version: 1, enabled: !!config, provider: config?.provider ?? null,
    chainId: options.chainId, contract: options.contract,
    ...(config?.r2 && { publicUrl: config.r2.publicUrl }),
    maxFileBytes, dailyFiles: config?.dailyFiles ?? 0,
    retention: "best-effort", message: config ? "Media availability depends on the configured storage operator." : "Photo uploads are not configured on this service yet." }));
  if (!config) return;
  if (options.dbPath !== ":memory:") mkdirSync(dirname(options.dbPath), { recursive: true });
  const db = new DatabaseSync(options.dbPath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS media_files (hash TEXT PRIMARY KEY, cid TEXT NOT NULL, size INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS media_attempts (account TEXT NOT NULL, day TEXT NOT NULL, files INTEGER NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(account,day));`);
  const now = options.now ?? Date.now, inFlight = new Map<string, Promise<{ url: string; hash: string; size: number }>>();
  let active = 0;
  await app.register(async routes => {
    routes.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: maxFileBytes }, (_req, body, done) => done(null, body));
    routes.post("/v1/media", { bodyLimit: maxFileBytes }, async request => {
      if (active >= 4) throw new SponsorRefusal("temporarily_unavailable", "Photo uploads are busy. Please try again shortly.");
      const header = request.headers["x-osp-media-proof"];
      if (typeof header !== "string" || header.length > 4096) throw new SponsorRefusal("invalid_signature", "A signed upload request is required");
      let proof: MediaUploadStatement & { signature: string };
      try { proof = JSON.parse(utf8Decode(fromBase64url(header))) as typeof proof; } catch { throw new SponsorRefusal("invalid_signature", "Invalid upload proof"); }
      const body = request.body;
      if (!proof || !Buffer.isBuffer(body) || !body.length || typeof proof.account !== "string" || typeof proof.signer !== "string" || !Number.isSafeInteger(proof.expires) || proof.expires < now() || proof.expires > now() + 300_000 ||
        proof.chainId !== options.chainId || proof.contract !== options.contract || proof.endpoint !== options.endpoint || !isAddress(proof.account) || !isAddress(proof.signer) ||
        proof.size !== body.length || typeof proof.signature !== "string" || proof.signature.length > 100 ||
        ![...IMAGE_MIMES, ...(config.provider === "r2" ? [...MUSIC_MIMES, "video/mp4", "video/webm"] : []), "application/octet-stream"].includes(proof.mime as typeof IMAGE_MIMES[number]) || proof.hash !== toBase64url(contentHash(body)) ||
        !verifyMediaUpload(proof, proof.signature)) throw new SponsorRefusal("invalid_signature", "Upload authorization is invalid or expired");
      active++;
      try {
        let owner: string | undefined;
        try { owner = await options.ownerOf(proof.account); } catch { throw new SponsorRefusal("temporarily_unavailable", "Your account could not be verified. Try uploading again."); }
        // Bootstrap a small profile before identity.register. Existing accounts
        // always use their current owner, including after an owner rotation.
        let allowedDevice = false;
        if (owner && owner !== proof.signer && options.authorizedDevice) {
          try { allowedDevice = await options.authorizedDevice(proof.account, proof.signer); }
          catch { throw new SponsorRefusal("temporarily_unavailable", "Your browser's upload authority could not be verified. Try again later."); }
        }
        if (owner ? owner !== proof.signer && !allowedDevice : config.provider !== "r2" || proof.signer !== proof.account || proof.size > 512)
          throw new SponsorRefusal("invalid_signature", "Upload must be signed by the account's current owner; new accounts may upload a small profile only");
        const previous = db.prepare("SELECT cid,size FROM media_files WHERE hash=?").get(proof.hash) as Row | undefined;
        if (previous && (config.provider !== "r2" || previous.cid.startsWith(`${config.r2!.publicUrl}/osp/`))) return { url: receiptUrl(previous.cid), hash: proof.hash, size: previous.size };
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
          try { cid = await (options.pin ?? (r2 ? ((bytes,mime,hash) => r2.put(bytes,hash)) : ((bytes,mime,hash) => pinMedia(config,bytes,mime,hash))))(body,proof.mime,proof.hash);
            receiptUrl(cid); }
          catch { throw new SponsorRefusal("temporarily_unavailable", "The image storage provider did not confirm the upload. Your post has not been published. Please try again."); }
          db.prepare("INSERT OR REPLACE INTO media_files VALUES (?,?,?)").run(proof.hash,cid,body.length);
          return { url: receiptUrl(cid), hash: proof.hash, size: body.length };
        })();
        inFlight.set(proof.hash,upload);
        try { return await upload; } finally { inFlight.delete(proof.hash); }
      } finally { active--; }
    });
  });
  app.addHook("onClose", async () => { await Promise.allSettled(inFlight.values()); r2?.close(); db.close(); });
}
