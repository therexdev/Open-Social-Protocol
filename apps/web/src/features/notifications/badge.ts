/** Unread notification count: indexer cursor vs. the locally stored "seen" cursor (no secrets). */
import { useEffect, useState } from "react";
import { useServices } from "../../api/services";
import { useVault } from "../../vault/store";
import { safeLocalStorage } from "../../util/webStorage";

const storage = safeLocalStorage();

export function seenKey(account: string): string {
  return `osp.web.seen.${account}`;
}

export function getSeenCursor(account: string): string | undefined {
  return storage.getItem(seenKey(account)) ?? undefined;
}

export function setSeenCursor(account: string, cursor: string): void {
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
    const refresh = async () => {
      try {
        const since = getSeenCursor(account);
        const page = await indexer.notifications(account, { ...(since && { since }), limit: 100 });
        if (!cancelled) setUnread(since ? page.items.length : page.items.filter((n) => Number(n.timestamp) > Date.now() - 7 * 86_400_000).length);
      } catch {
        if (!cancelled) setUnread(0);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, pollMs);
    const onSeen = () => void refresh();
    window.addEventListener("osp:seen", onSeen);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("osp:seen", onSeen);
    };
  }, [account, status, indexer, pollMs]);
  return unread;
}
