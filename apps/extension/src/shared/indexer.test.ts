import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexerClient } from "./indexer";

afterEach(() => { vi.unstubAllGlobals(); });

describe("IndexerClient browser transport", () => {
  it.each([false, true])("calls fetch with its browser receiver (injected=%s)", async (injected) => {
    const urls: string[] = [];
    const browserFetch = function (this: unknown, url: string): Promise<Response> {
      if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      urls.push(url);
      return Promise.resolve(new Response(JSON.stringify({ healthy: true }), { status: 200 }));
    };
    vi.stubGlobal("fetch", browserFetch);
    const client = new IndexerClient({ baseUrl: "https://indexer.test/", ...(injected && { fetch: browserFetch }) });
    await expect(client.status()).resolves.toMatchObject({ healthy: true });
    expect(urls).toEqual(["https://indexer.test/v1/status"]);
  });
});
