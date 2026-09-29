import { fromBase64url, ipfsCid, MAX_IMAGE_BYTES, openMedia } from "@osp/sdk";

// Only public bytes or encrypted file bytes, never private plaintext or keys.
// Keep recent uploads visible when the local preview becomes an indexed post.
const files = new Map<string, { bytes: Uint8Array; expires: number }>();
const MAX_CACHE_BYTES = 12 * 1024 * 1024;
let total = 0;
const key = (location: string, hash: string) => `${ipfsCid(location)}:${hash}`;
function remove(id: string) { const entry = files.get(id); if (entry) total -= entry.bytes.length; files.delete(id); }
export function rememberMediaBytes(location: string, hash: string, bytes: Uint8Array): void {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return;
  openMedia(bytes, fromBase64url(hash)); // Verify before caching, even for upload receipts.
  const id = key(location, hash);
  remove(id);
  for (const [old, entry] of files) if (entry.expires <= Date.now()) remove(old);
  while (total + bytes.length > MAX_CACHE_BYTES) remove(files.keys().next().value!);
  files.set(id, { bytes: new Uint8Array(bytes), expires: Date.now() + 5 * 60_000 });
  total += bytes.length;
}
export function cachedMediaBytes(location: string, hash: string): Uint8Array | undefined {
  const id = key(location, hash), entry = files.get(id);
  if (!entry) return;
  if (entry.expires <= Date.now()) { remove(id); return; }
  files.delete(id); files.set(id, entry);
  return new Uint8Array(entry.bytes);
}
