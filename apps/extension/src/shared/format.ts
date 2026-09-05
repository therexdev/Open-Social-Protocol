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
