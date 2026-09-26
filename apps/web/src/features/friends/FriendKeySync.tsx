import { useEffect, useState } from "react";
import { useServices } from "../../api/services";
import { Button, Notice } from "../../components/ui";
import { useAccount } from "../../stores/account";
import { humanizeError } from "../../tx/submit";
import { useSession, useSubmitContext } from "../session";
import { syncFriendKeys } from "./syncKeys";

/** Existing friendships are repaired too; no new post or second friend request is needed. */
export function FriendKeySync() {
  const session = useSession();
  const ctx = useSubmitContext();
  const { indexer } = useServices();
  const registration = useAccount((s) => s.registration);
  const registeredAccount = useAccount((s) => s.account);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [shared, setShared] = useState(false);
  useEffect(() => {
    setError(undefined);
    setShared(false);
    if (!session || !ctx || !indexer.configured || registration !== "registered" || registeredAccount !== session.identity.account) return;
    let cancelled = false;
    let busy = false;
    const refresh = async () => {
      if (cancelled || busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const accounts = await syncFriendKeys({ ctx, me: session.identity, keys: session.keys, indexer, isCurrent: () => !cancelled });
        if (!cancelled && accounts.length > 0) setShared(true);
        if (!cancelled) setError(undefined);
      } catch (e) {
        if (!cancelled) setError(humanizeError(e));
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("osp:sync-friend-keys", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("osp:sync-friend-keys", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [session, ctx, indexer, registration, registeredAccount, retry]);
  if (!error) return shared ? <Notice kind="success">Access to your friends-only posts has been shared, including older posts.</Notice> : null;
  return <Notice kind="warning">Some friends may still be waiting for access to your private posts. {error}{" "}<Button onClick={() => setRetry((n) => n + 1)}>Retry sharing</Button></Notice>;
}
