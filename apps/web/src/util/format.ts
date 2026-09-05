/** Presentation helpers: never leak secrets, keep protocol jargon out of the default journey. */

export function shortAddress(address: string | undefined | null, edge = 6): string {
  if (!address) return "";
  if (address.length <= edge * 2 + 1) return address;
  return `${address.slice(0, edge)}…${address.slice(-edge)}`;
}

/** Formats a ms timestamp (decimal string or number) relative to now, falling back to a date. */
export function timeAgo(value: string | number | undefined, now: number = Date.now()): string {
  const ms = typeof value === "string" ? Number(value) : value;
  if (!ms || !Number.isFinite(ms) || ms <= 0) return "";
  const diff = Math.max(0, now - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)} h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} d ago`;
  return new Date(ms).toLocaleDateString();
}

export function formatDateTime(value: string | number | undefined): string {
  const ms = typeof value === "string" ? Number(value) : value;
  if (!ms || !Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleString();
}

export function formatDuration(ms: number | string): string {
  const n = typeof ms === "string" ? Number(ms) : ms;
  if (!Number.isFinite(n) || n <= 0) return "0 min";
  const minutes = Math.round(n / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Human text for an unknown error without dumping stack traces or secrets. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong";
}
