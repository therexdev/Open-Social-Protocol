export function shortAddress(address: string | undefined, head = 6, tail = 4): string {
  if (!address) return "";
  return address.length <= head + tail + 1 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function formatTime(ms: string | number | undefined): string {
  if (ms === undefined || ms === "" || ms === "0") return "";
  const n = typeof ms === "string" ? Number(ms) : ms;
  if (!Number.isFinite(n) || n <= 0) return "";
  const date = new Date(n);
  const now = Date.now();
  const diff = now - n;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function audienceName(audience: number): string {
  return audience === 0 ? "Everyone" : audience === 1 ? "Friends" : "Custom audience";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * An http(s) URL safe to render as a link from an extension page; undefined for anything else
 * (other schemes such as data:, file: or chrome-extension:, malformed or oversized values).
 * External references come from other users' posts and are untrusted.
 */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : undefined;
  } catch {
    return undefined;
  }
}
