import { bytesEqual, contentHash, MUSIC_CHUNK_BYTES, musicChunks, toBase64url, type MusicRecord, type ProtocolClient } from "@osp/sdk";

type Gateway = { url: string; fetch: typeof fetch };
const gateways = new WeakMap<ProtocolClient, Gateway>();
export function configureMusicGateway(client: ProtocolClient, url?: string, fetcher: typeof fetch = fetch) {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return;
    gateways.set(client, { url: url.replace(/\/+$/, ""), fetch: fetcher });
  } catch { /* A malformed optional endpoint must not stop chain playback. */ }
}
export function hasMusicGateway(client: ProtocolClient) { return gateways.has(client); }

/** The endpoint is untrusted. Bound response bytes and verify every chunk against the
 * freshly read on-chain manifest before accepting it. Fail closed to the chain path. */
export async function readMusicGateway(
  client: ProtocolClient, id: Uint8Array, record: MusicRecord, index: number, count: number, signal?: AbortSignal,
): Promise<Uint8Array[] | undefined> {
  const gateway = gateways.get(client);
  if (!gateway || count < 1 || count > 64) return;
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) return;
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 8000);
  const start = index * MUSIC_CHUNK_BYTES, end = Math.min(record.size, (index + count) * MUSIC_CHUNK_BYTES) - 1;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const url = `${gateway.url}/v1/music/${encodeURIComponent(toBase64url(id))}/bytes?digest=${encodeURIComponent(toBase64url(record.digest))}`;
    const response = await gateway.fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (response.status !== 206 || response.headers.get("Content-Range") !== `bytes ${start}-${end}/${record.size}` || !response.body) return;
    const length = end - start + 1, bytes = new Uint8Array(length);
    reader = response.body.getReader();
    let offset = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      if (offset + item.value.length > length) return;
      bytes.set(item.value, offset); offset += item.value.length;
    }
    if (offset !== length || signal?.aborted) return;
    const chunks = musicChunks(bytes);
    if (chunks.length !== count || chunks.some((chunk, i) => !bytesEqual(contentHash(chunk), record.chunk_hashes[index + i]!))) return;
    return chunks;
  } catch { return undefined; }
  finally {
    clearTimeout(timeout); signal?.removeEventListener("abort", abort);
    controller.abort();
    await reader?.cancel().catch(() => undefined);
  }
}
