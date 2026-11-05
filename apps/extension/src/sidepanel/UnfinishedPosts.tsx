import { useEffect, useState } from "react";
import { rpc } from "../shared/rpc";
import { usePanel } from "./store";

/** Recovery for interrupted/failed publications, not a step before posting. */
export function UnfinishedPosts() {
  const [hostLinks, setHostLinks] = useState<Record<string, string>>({});
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
      {(record.awaitingFacebook || record.awaitingX) && <label>Published {record.awaitingX ? "X" : "Facebook"} post link<input type="url" placeholder={record.awaitingX ? "https://x.com/…/status/…" : "https://www.facebook.com/…/posts/…"} value={hostLinks[record.attemptId] ?? ""} onChange={e => setHostLinks(previous => ({ ...previous, [record.attemptId]: e.target.value }))}/><small>The Open Social copy is saved and waiting for its {record.awaitingX ? "X" : "Facebook"} link.</small></label>}
      <div className="row">
        {record.awaitingFacebook || record.awaitingX ? <button disabled={busy || !hostLinks[record.attemptId]?.trim()} onClick={async () => { await run(() => rpc(record.awaitingX ? "crosspost.finishX" : "crosspost.finishFacebook", { attemptId: record.attemptId, url: hostLinks[record.attemptId]!.trim() })); await loadQueue(); }}>Publish with {record.awaitingX ? "X" : "Facebook"} link</button> : record.state === "draft" ? <button disabled={busy} onClick={() => setPrefill({ text: record.text || "", audience: record.audience, attemptId: record.attemptId, adapter: record.adapter === "generic" ? "generic" : "sidepanel", ...(record.adapter === "generic" && { url: record.url, title: record.title }) })}>Continue draft</button> : <button disabled={busy} onClick={async () => { await run(() => rpc(record.koinosStatus === "failed" ? "crosspost.retry" : "crosspost.reconcile", { attemptId: record.attemptId })); await loadQueue(); }}>{record.koinosStatus === "failed" ? "Retry publish" : "Check status"}</button>}
        {record.state === "draft" && <button disabled={busy} onClick={async () => { await run(() => rpc("crosspost.discard", { attemptId: record.attemptId })); await loadQueue(); }}>Remove draft</button>}
      </div>
    </div>)}
  </div>;
}
