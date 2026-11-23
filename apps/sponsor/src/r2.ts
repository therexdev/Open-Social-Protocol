import { readFileSync } from "node:fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
}
export function loadR2Config(env: Record<string, string | undefined>): R2Config {
  const required = (name: string) => {
    const value = env[`${name}_FILE`] ? readFileSync(env[`${name}_FILE`]!, "utf8").trim() : env[name]?.trim();
    if (!value) throw Error(`Configure ${name} or ${name}_FILE`);
    return value;
  };
  const accountId = required("OSP_MEDIA_R2_ACCOUNT_ID"), bucket = required("OSP_MEDIA_R2_BUCKET");
  if (!/^[a-f0-9]{32}$/.test(accountId) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw Error("Invalid R2 account or bucket");
  const url = new URL(required("OSP_MEDIA_R2_PUBLIC_URL"));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw Error("Use an HTTPS R2 media domain without credentials, query or fragment");
  return { accountId, bucket, accessKeyId: required("OSP_MEDIA_R2_ACCESS_KEY_ID"), secretAccessKey: required("OSP_MEDIA_R2_SECRET_ACCESS_KEY"), publicUrl: url.href.replace(/\/+$/, "") };
}
export function r2Key(chainId: string, contract: string, hash: string): string {
  // Separate deployments and make retries use the same immutable object key.
  const scope = Buffer.from(chainId).toString("base64url");
  if (!/^[A-Za-z0-9_-]{43}=?$/.test(hash) || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(contract)) throw Error("Invalid media object identity");
  return `osp/${scope}/${contract}/${hash}`;
}
export function createR2Writer(config: R2Config, chainId: string, contract: string) {
  const client = new S3Client({ region: "auto", endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, maxAttempts: 2,
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  return {
    close: () => client.destroy(),
    async put(bytes: Uint8Array, hash: string): Promise<string> {
      const key = r2Key(chainId, contract, hash);
      await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: bytes,
        ContentType: "application/octet-stream", ContentLength: bytes.length,
        CacheControl: "public, max-age=31536000, immutable" }), { abortSignal: AbortSignal.timeout(60_000) });
      return `${config.publicUrl}/${key}`;
    },
  };
}
