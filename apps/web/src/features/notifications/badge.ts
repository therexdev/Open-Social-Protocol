/** Unread notification count: indexer cursor vs. the locally stored "seen" cursor (no secrets). */
import { useEffect, useState } from "react";
import { useServices } from "../../api/services";
import { useVault } from "../../vault/context";
import { safeLocalStorage } from "../../util/webStorage";

const storage = safeLocalStorage();

export function seenKey(account: string): string {
  return `osp.web.seen.${account}`;
}

export function getSeenCursor(account: string): string | undefined {
  return storage.getItem(seenKey(account)) ?? undefined;
}

export function isNewerCursor(cursor: string, seen?: string): boolean {
  return /^\d+$/.test(cursor) && (seen === undefined || !/^\d+$/.test(seen) || BigInt(cursor) > BigInt(seen));
}

export function setSeenCursor(account: string, cursor: string): void {
  if (!isNewerCursor(cursor, getSeenCursor(account))) return;
  storage.setItem(seenKey(account), cursor);
  window.dispatchEvent(new CustomEvent("osp:seen", { detail: { account, cursor } }));
}

export function useNotificationsBadge(pollMs = 60_000): number {
  const account = useVault((s) => s.account);
  const status = useVault((s) => s.status);
  const { indexer } = useServices();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!account || status !== "unlocked" || !indexer.configured) {
      setUnread(0);
      return;
    }
    let cancelled = false;
    let busy = false;
    let latest: { id: string; timestamp: string }[] = [];
    setUnread(0);
    const recount = () => {
      const seen = getSeenCursor(account);
      setUnread(latest.filter(n => isNewerCursor(n.id, seen) && (seen !== undefined || Number(n.timestamp) > Date.now() - 7 * 86_400_000)).length);
    };
    const refresh = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const since = getSeenCursor(account);
        const page = await indexer.notifications(account, { ...(since && { since }), limit: 100 });
        if (!cancelled) { latest = page.items; recount(); } // Re-read the cursor after the request: Activity may have cleared it in flight.
      } catch {
        if (!cancelled) setUnread(0);
      } finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, pollMs);
    const onSeen = (event: Event) => {
      if ((event as CustomEvent<{ account: string }>).detail?.account === account) recount();
    };
    const onStorage = (event: StorageEvent) => { if (event.key === seenKey(account)) recount(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("osp:seen", onSeen);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("osp:seen", onSeen);
      window.removeEventListener("storage", onStorage);
    };
  }, [account, status, indexer, pollMs]);
  return unread;
}
