import { useEffect, useState } from "react";
import { useServices } from "../../api/services";
import { Button, Notice } from "../../components/ui";
import { humanizeError } from "../../tx/submit";
import { useSession, useSubmitContext } from "../session";
import { syncFriendKeys, type FriendKeySyncProgress } from "./syncKeys";

/** Sharing is independent of the registration banner's cached lookup result. */
export function FriendKeySync() {
  const session = useSession();
  const ctx = useSubmitContext();
  const { indexer } = useServices();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    setError(undefined);
    setMessage(undefined);
    setBusy(false);
    setVerified(false);
    let cancelled = false;
    let running = false;
    let repairPending = false;
    const refresh = async (repair = false) => {
      if (cancelled) return;
      if (repair) repairPending = true;
      if (running || (!repairPending && document.visibilityState === "hidden")) return;
      if (!session || !ctx || !indexer.configured) {
        if (repairPending) setError(!session ? "Unlock your account to share private-post access." : "Connect to the network and indexer in Settings to share private-post access.");
        repairPending = false;
        return;
      }
      running = true;
      do {
        const force = repairPending;
        repairPending = false;
        let progress: FriendKeySyncProgress | undefined;
        try {
          // Routine polling must not move the page or announce success every 30 seconds.
          // Only an explicit repair owns the progress/result notice.
          if (force) {
            setError(undefined);
            setBusy(true);
            setVerified(false);
            setMessage("Checking private-post access…");
          }
          await syncFriendKeys({ ctx, me: session.identity, keys: session.keys, indexer,
            repair: force, fullHistory: true, isCurrent: () => !cancelled,
            onProgress: (next) => {
              progress = next;
              if (!cancelled && force) setMessage(`Sharing private-post access: checked ${next.checked} of ${next.total} periods; ${next.transactions} deliveries confirmed.`);
            },
          });
          if (!cancelled) {
            setError(undefined);
          }
          if (!cancelled && force) {
            if (!progress?.complete) setMessage("The friendship changed while sharing. Access will be checked again automatically.");
            else if (!progress.friends) setMessage(force ? "No active friends were found. Sharing will run again after a friendship is accepted." : undefined);
            else if (!progress.keys) setMessage(force ? "No recoverable private-post keys were found for this account. No access was sent." : undefined);
            else setMessage(`Private-post access checked for ${progress.friends} friend(s): ${progress.keys} reading key(s), ${progress.transactions} deliveries confirmed. Their app may take a moment to refresh.`);
            setVerified(Boolean(progress?.complete && progress.keys > 0));
          }
        } catch (e) {
          if (!cancelled) { setError(humanizeError(e)); setMessage(undefined); }
        }
        // A repair clicked during a background pass is queued, never silently dropped.
      } while (!cancelled && repairPending);
      running = false;
      if (!cancelled) setBusy(false);
    };
    const automatic = () => { void refresh(); };
    const requested = (event: Event) => { void refresh((event as CustomEvent<{ repair?: boolean }>).detail?.repair === true); };
    void refresh();
    const timer = window.setInterval(automatic, 30_000);
    window.addEventListener("focus", automatic);
    window.addEventListener("online", automatic);
    window.addEventListener("osp:sync-friend-keys", requested);
    document.addEventListener("visibilitychange", automatic);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", automatic);
      window.removeEventListener("online", automatic);
      window.removeEventListener("osp:sync-friend-keys", requested);
      document.removeEventListener("visibilitychange", automatic);
    };
  }, [session, ctx, indexer]);
  if (error) return <Notice kind="warning">Private-post access could not be shared. {error}{" "}<Button onClick={() => window.dispatchEvent(new CustomEvent("osp:sync-friend-keys", { detail: { repair: true } }))}>Retry sharing</Button></Notice>;
  return message ? <div role="status" aria-live="polite" aria-busy={busy}><Notice kind={!busy && verified ? "success" : "info"}>{message}{!busy && <> <Button onClick={() => setMessage(undefined)}>Dismiss</Button></>}</Notice></div> : null;
}
