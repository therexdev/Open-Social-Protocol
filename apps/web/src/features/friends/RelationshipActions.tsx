/** Friend / follow / block buttons for another account, driven by /v1/graph of the viewer. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Button, ConfirmDialog } from "../../components/ui";
import { useSettings } from "../../stores/settings";
import { useVault } from "../../vault/context";
import { useCanAct, useSession, useSubmitContext } from "../session";
import { BLOCK_WARNING, REMOVE_FRIEND_WARNING, acceptFriend, block, follow, removeFriend, requestFriend, unblock, unfollow } from "./actions";

export function useGraph(account: string | undefined) {
  const { indexer } = useServices();
  const [graph, setGraph] = useState<GraphView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    if (!account || !indexer.configured) return;
    const request = ++version.current;
    setLoading(true);
    try {
      const next = await indexer.graph(account);
      if (request !== version.current) return;
      setGraph(next);
      setError(undefined);
    } catch (e) {
      if (request === version.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === version.current) setLoading(false);
    }
  }, [account, indexer]);
  useEffect(() => {
    setGraph(undefined);
    void refresh();
    const tick = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const timer = window.setInterval(tick, 15_000);
    window.addEventListener("focus", tick);
    return () => { version.current++; window.clearInterval(timer); window.removeEventListener("focus", tick); };
  }, [refresh]);
  return { graph, error, loading, refresh };
}

export interface RelationshipActionsProps {
  target: string;
  graph?: GraphView;
  onChanged?: () => void;
  compact?: boolean;
}

export function RelationshipActions({ target, graph, onChanged, compact }: RelationshipActionsProps) {
  const me = useVault((s) => s.account);
  const can = useCanAct();
  const ctx = useSubmitContext();
  const session = useSession();
  const { indexer } = useServices();
  const muted = useSettings((s) => s.muted);
  const update = useSettings((s) => s.update);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [confirm, setConfirm] = useState<"remove" | "block" | undefined>();
  if (!me || me === target) return null;
  const isFriend = graph?.friends.some((f) => f.account === target) ?? false;
  const incoming = graph?.pendingIncoming.some((f) => f.account === target) ?? false;
  const outgoing = graph?.pendingOutgoing.some((f) => f.account === target) ?? false;
  const following = graph?.following.includes(target) ?? false;
  const blocked = graph?.blocked.includes(target) ?? false;
  const isMuted = muted.includes(target);
  const disabled = !can.ok || !ctx || busy;

  const run = async (fn: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await fn();
      setConfirm(undefined);
      window.dispatchEvent(new Event("osp:sync-friend-keys"));
    } catch {
      // toast explains
    } finally {
      // A rejection can follow an earlier successful removal. Refresh even on failure.
      onChanged?.();
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="row actions" title={can.ok ? undefined : can.reason}>
      {blocked ? (
        <Button onClick={() => ctx && void run(() => unblock(ctx, target))} disabled={disabled}>
          Unblock
        </Button>
      ) : (
        <>
          {isFriend && (
            <Button onClick={() => setConfirm("remove")} disabled={disabled}>
              Remove friend
            </Button>
          )}
          {incoming && (
            <Button variant="primary" onClick={() => ctx && void run(() => acceptFriend(ctx, target, session && { keys: session.keys, me: session.identity, source: indexer }))} disabled={disabled}>
              Accept request
            </Button>
          )}
          {outgoing && <span className="muted">Request sent</span>}
          {!isFriend && !incoming && !outgoing && (
            <Button variant="primary" onClick={() => ctx && void run(() => requestFriend(ctx, target))} disabled={disabled}>
              Add friend
            </Button>
          )}
          <Button onClick={() => ctx && void run(() => (following ? unfollow(ctx, target) : follow(ctx, target)))} disabled={disabled}>
            {following ? "Unfollow" : "Follow"}
          </Button>
          {!compact && (
            <>
              <Button variant="ghost" onClick={() => update({ muted: isMuted ? muted.filter((a) => a !== target) : [...muted, target] })}>
                {isMuted ? "Unmute" : "Mute"}
              </Button>
              <Button variant="danger" onClick={() => setConfirm("block")} disabled={disabled}>
                Block
              </Button>
            </>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirm === "remove"}
        title="Remove this friend?"
        confirmLabel="Remove friend"
        danger
        busy={busy}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => ctx && void run(() => removeFriend(ctx, target))}
      >
        <p>{REMOVE_FRIEND_WARNING}</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "block"} title="Block this account?" confirmLabel="Block" danger busy={busy} onCancel={() => setConfirm(undefined)} onConfirm={() => ctx && void run(() => block(ctx, target))}>
        <p>{BLOCK_WARNING}</p>
      </ConfirmDialog>
    </div>
  );
}
