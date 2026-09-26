import { useEffect } from "react";
import { rpc } from "../shared/rpc";
import { usePanel } from "./store";

/** Recovery for interrupted/failed publications, not a step before posting. */
export function UnfinishedPosts() {
  const { queue, loadQueue, run, busy, status, setPrefill } = usePanel();
  const items = queue.filter(({ record: r }) => (r.koinosStatus !== "ok" || r.state === "reconcile_required") && (!r.author || r.author === status?.account));
  const waiting = items.some(({ record: r }) => ["pending", "unknown"].includes(r.koinosStatus) && r.state !== "draft");
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(async () => {
      // Look up uncertain submissions; never retry a send automatically.
      for (const { record } of items) if (["unknown", "submitting", "reconcile_required"].includes(record.state)) await rpc("crosspost.reconcile", { attemptId: record.attemptId }).catch(() => undefined);
      await loadQueue();
    }, 5000);
    return () => clearInterval(timer);
  }, [waiting, queue, loadQueue]);
  if (!items.length) return null;
  return <div>
    <h3>Unfinished posts</h3>
    {items.map(({ record }) => <div className="card" key={record.attemptId}>
      <p className="muted">{record.state === "draft" ? "Saved draft" : record.koinosStatus === "failed" ? "Publication failed" : "Confirming publication"} · {record.audience === 1 ? "Friends" : "Public"}</p>
      {record.text && <p className="text">{record.text}</p>}
      {record.lastError && <p className="error">{record.lastError}</p>}
      <div className="row">
        {record.state === "draft" ? <button disabled={busy} onClick={() => setPrefill({ text: record.text || "", audience: record.audience, attemptId: record.attemptId, adapter: record.adapter === "generic" ? "generic" : "sidepanel", ...(record.adapter === "generic" && { url: record.url, title: record.title }) })}>Continue draft</button> : <button disabled={busy} onClick={async () => { await run(() => rpc(record.koinosStatus === "failed" ? "crosspost.retry" : "crosspost.reconcile", { attemptId: record.attemptId })); await loadQueue(); }}>{record.koinosStatus === "failed" ? "Retry publish" : "Check status"}</button>}
        {record.state === "draft" && <button disabled={busy} onClick={async () => { await run(() => rpc("crosspost.discard", { attemptId: record.attemptId })); await loadQueue(); }}>Remove draft</button>}
      </div>
    </div>)}
  </div>;
}
