import type { FetchLike } from "./indexer";

/** Optional indexer wakeups. Ordinary polling remains the recovery path. */
export function watchPrivateUpdates(baseUrl: string, fetch: FetchLike | undefined, changed: () => void): () => void {
  if (!baseUrl || !fetch) return () => {};
  const controller = new AbortController();
  let cursor = "", failures = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let finishDelay: (() => void) | undefined;
  const delay = (ms: number) => new Promise<void>(resolve => { finishDelay = resolve; timer = setTimeout(resolve, ms); });
  const run = async () => {
    while (!controller.signal.aborted) {
      const request = new AbortController();
      const abort = () => request.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      // Longer than the server's 20-second long poll, including response body.
      const timeout = setTimeout(abort, 30_000);
      let retry = 0;
      try {
        const response = await fetch(`${baseUrl}/v2/private/updates${cursor ? `?cursor=${cursor}` : ""}`, {
          signal: request.signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
        });
        // An older indexer can continue serving the existing packet API.
        if (response.status === 404 || response.status === 405) return;
        if (!response.ok) throw new Error("Update connection unavailable");
        const result = await response.json() as { cursor?: unknown; retryAfterMs?: unknown };
        if (typeof result.cursor !== "string" || !/^[a-f0-9]{64}$/.test(result.cursor)) throw new Error("Invalid update cursor");
        if (controller.signal.aborted) return;
        if (result.cursor !== cursor) { cursor = result.cursor; changed(); }
        failures = 0;
        // Bound even an immediately answering/misconfigured endpoint's request rate.
        retry = typeof result.retryAfterMs === "number" && Number.isFinite(result.retryAfterMs)
          ? Math.min(30_000, Math.max(500, result.retryAfterMs)) : 500;
      } catch {
        if (controller.signal.aborted) return;
        retry = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", abort);
      }
      if (!controller.signal.aborted) await delay(retry);
    }
  };
  void run();
  return () => { controller.abort(); clearTimeout(timer); finishDelay?.(); };
}
