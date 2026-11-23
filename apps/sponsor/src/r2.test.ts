import { expect, it, vi } from "vitest";
import { contentHash, toBase64url, utf8 } from "@osp/sdk";
const send = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = send; destroy() {} },
  PutObjectCommand: class { constructor(public input: unknown) {} },
}));
import { createR2Writer, loadR2Config, r2Key } from "./r2.js";
const env = {
  OSP_MEDIA_R2_ACCOUNT_ID: "a".repeat(32), OSP_MEDIA_R2_BUCKET: "opensocial-testnet-media",
  OSP_MEDIA_R2_ACCESS_KEY_ID: "access-id", OSP_MEDIA_R2_SECRET_ACCESS_KEY: "secret",
  OSP_MEDIA_R2_PUBLIC_URL: "https://media.example",
};
it("requires scoped credentials and a safe HTTPS media base", () => {
  expect(loadR2Config(env)).toMatchObject({ bucket: "opensocial-testnet-media", publicUrl: "https://media.example" });
  expect(() => loadR2Config({ ...env, OSP_MEDIA_R2_SECRET_ACCESS_KEY: "" })).toThrow("SECRET_ACCESS_KEY");
  expect(() => loadR2Config({ ...env, OSP_MEDIA_R2_PUBLIC_URL: "https://user:password@example.org" })).toThrow("HTTPS");
  expect(() => loadR2Config({ ...env, OSP_MEDIA_R2_ACCOUNT_ID: "../other" })).toThrow("Invalid R2");
});
it("names immutable objects by deployment and ciphertext hash and uploads opaque bytes", async () => {
  send.mockClear();
  const config = loadR2Config(env), bytes = utf8("ciphertext"), hash = toBase64url(contentHash(bytes));
  const writer = createR2Writer(config, "testnet", "1ABC"), key = r2Key("testnet", "1ABC", hash);
  expect(await writer.put(bytes, hash)).toBe(`${config.publicUrl}/${key}`);
  expect(send.mock.calls[0]![0].input).toMatchObject({ Bucket: config.bucket, Key: key, Body: bytes, ContentType: "application/octet-stream", ContentLength: bytes.length });
  expect(() => r2Key("testnet", "1ABC", "../bad")).toThrow("identity");
  writer.close();
});
