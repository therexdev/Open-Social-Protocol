import { afterEach, expect, it, vi } from "vitest";
import { contentHash, ProtocolClient, utf8, type MusicRecord } from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../../testing/fixtures";
import { configureMusicGateway, readMusicGateway } from "./musicGateway";

afterEach(() => vi.unstubAllGlobals());

it.each([false, true])("reads a verified music range with the browser fetch receiver (injected=%s)", async injected => {
  const client = new ProtocolClient({ rpc: fakeProvider(), deployment: fixtureDeployment() });
  const bytes = utf8("hosted music range"), digest = contentHash(bytes);
  const record = { size: bytes.length, digest, chunk_hashes: [digest] } as MusicRecord;
  const browserFetch = vi.fn(async function (this: unknown, _url: string | URL | Request, init?: RequestInit) {
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    expect(new Headers(init?.headers).get("Range")).toBe(`bytes=0-${bytes.length - 1}`);
    return new Response(new Uint8Array(bytes), { status: 206,
      headers: { "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}` } });
  });
  vi.stubGlobal("fetch", browserFetch);
  configureMusicGateway(client, "https://mirror.test", injected ? browserFetch : undefined);
  await expect(readMusicGateway(client, new Uint8Array(32), record, 0, 1)).resolves.toEqual([bytes]);
  expect(browserFetch).toHaveBeenCalledOnce();
});
