import { expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentHash, contentReference, createContentLoader, toBase64url, utf8 } from "@osp/sdk";
const send = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = send; destroy() {} },
  PutObjectCommand: class { constructor(public input: unknown) {} },
  CreateMultipartUploadCommand: class { constructor(public input: unknown) {} },
  UploadPartCommand: class { constructor(public input: unknown) {} },
  CompleteMultipartUploadCommand: class { constructor(public input: unknown) {} },
  AbortMultipartUploadCommand: class { constructor(public input: unknown) {} },
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

it("streams fixed-size R2 multipart parts from disk and aborts an uncertain upload", async () => {
  const folder = await mkdtemp(join(tmpdir(), "osp-r2-test-")), path = join(folder, "recording"), bytes = new Uint8Array(8 * 1024 * 1024 + 7);
  await writeFile(path, bytes); const inputs: any[] = [];
  send.mockImplementation(async command => {
    const input = command.input; inputs.push(input);
    if (input.PartNumber) { let size = 0; for await (const part of input.Body) size += part.length; expect(size).toBe(input.ContentLength); return { ETag: `part-${input.PartNumber}` }; }
    if (input.MultipartUpload) return { ETag: "complete" };
    if (!input.UploadId) return { UploadId: "upload-1" };
    return {};
  });
  const writer = createR2Writer(loadR2Config(env), "mainnet", "1ABC");
  try {
    const hash = toBase64url(contentHash(bytes));
    expect(await writer.putFile(path, hash, bytes.length)).toContain(`/osp/`);
    expect(inputs.filter(i => i.PartNumber).map(i => i.ContentLength)).toEqual([8 * 1024 * 1024, 7]);
    expect(inputs.find(i => i.MultipartUpload).MultipartUpload.Parts).toEqual([{ PartNumber: 1, ETag: "part-1" }, { PartNumber: 2, ETag: "part-2" }]);
    inputs.length = 0;
    send.mockImplementation(async command => { inputs.push(command.input); if (!command.input.UploadId) return { UploadId: "broken" }; if (command.input.PartNumber) throw Error("provider failed"); return {}; });
    await expect(writer.putFile(path, hash, bytes.length)).rejects.toThrow("provider failed");
    expect(inputs.at(-1)).toMatchObject({ UploadId: "broken" }); expect(inputs.at(-1).PartNumber).toBeUndefined();
  } finally { writer.close(); send.mockReset().mockResolvedValue({}); await rm(folder, { recursive: true, force: true }); }
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
it.each(["AQIDBA==", "EiBZK_GGVP0H_fXVAM3j6EAuz3-B-l3ejxRSewi7qIBfSA=="])("reads uploaded content through the SDK using the writer's exact object path (%s)", async chainId => {
  const config = loadR2Config(env), bytes = utf8("hosted profile"), reference = contentReference(bytes);
  const contract = "1ABC";
  const writer = createR2Writer(config, chainId, contract);
  try {
    const location = await writer.put(bytes, toBase64url(reference.digest));
    const fetch = vi.fn(async (url: string | URL | Request) => String(url) === location
      ? new Response(new Uint8Array(bytes)) : new Response("not found", { status: 404 }));
    const load = createContentLoader({ publicUrl: config.publicUrl, chainId, identityContract: contract, fetch });
    await expect(load(reference)).resolves.toEqual(bytes);
    expect(fetch.mock.calls[0]![0]).toBe(location);
  } finally { writer.close(); }
});
