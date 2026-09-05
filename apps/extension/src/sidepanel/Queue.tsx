import { useEffect, useState } from "react";
import { AUDIENCE } from "@osp/sdk";
import type { QueueItem } from "../background/app";
import { audienceName, formatTime, shortAddress } from "../shared/format";
import type { QueueAction } from "../shared/protocol";
import { rpc } from "../shared/rpc";
import { ConfirmSheet } from "./Composer";
import { usePanel } from "./store";

const STATE_CLASS: Record<string, string> = { succeeded: "good", failed: "bad", reconcile_required: "bad", partial: "warn", unknown: "warn", draft: "", submitting: "" };
const ACTION_LABEL: Record<QueueAction, string> = {
  confirm: "Confirm…",
  retry: "Retry",
  reconcile: "Reconcile (look up on chain)",
  markHostPosted: "Mark posted on host",
  markHostFailed: "Mark host failed",
  recordProof: "Record proof on chain",
  discard: "Discard",
};

function Item({ item, onConfirm }: { item: QueueItem; onConfirm: (item: QueueItem) => void }) {
  const { run, loadQueue, busy } = usePanel();
  const { record, explanation } = item;
  async function act(action: QueueAction) {
    if (action === "confirm") {
      onConfirm(item);
      return;
    }
    const type = { retry: "crosspost.retry", reconcile: "crosspost.reconcile", recordProof: "crosspost.recordProof", discard: "crosspost.discard" }[action as Exclude<QueueAction, "confirm" | "markHostPosted" | "markHostFailed">];
    await run(async () => {
      if (action === "markHostPosted") await rpc("crosspost.markHost", { attemptId: record.attemptId, outcome: "posted" });
      else if (action === "markHostFailed") await rpc("crosspost.markHost", { attemptId: record.attemptId, outcome: "failed" });
      else await rpc(type, { attemptId: record.attemptId });
    });
    await loadQueue();
  }
  return (
    <div className={`card ${STATE_CLASS[record.state] ?? ""}`}>
      <div className="row" style={{ marginBottom: 4 }}>
        <span className={`pill ${STATE_CLASS[record.state] ?? ""}`}>{record.state.replace("_", " ")}</span>
        <span className="pill">{record.adapter === "facebook" ? "Facebook" : record.adapter === "generic" ? "Shared page" : "Side panel"}</span>
        <span className="pill">{audienceName(record.audience)}</span>
        <span className="muted">{formatTime(record.updatedAt)}</span>
      </div>
      <h3>{explanation.title}</h3>
      <p className="muted">{explanation.detail}</p>
      {record.text && (
        <div className="post">
          <div className="text">{record.text}</div>
        </div>
      )}
      <details>
        <summary>Details</summary>
        <div className="muted">
          attempt <code>{record.attemptId}</code>
          {record.idempotencyKey && (
            <>
              {" "}
              · key <code>{record.idempotencyKey}</code>
            </>
          )}
          {record.postId && (
            <>
              {" "}
              · post <code>{record.postId}</code>
            </>
          )}
          {record.koinosTxId && (
            <>
              {" "}
              · tx <code>{record.koinosTxId}</code>
            </>
          )}
          {record.hostRef && (
            <>
              {" "}
              · host <code>{record.hostRef}</code>
            </>
          )}
          {record.proof && (
            <>
              {" "}
              · proof <code>{record.proof.manifestHash}</code>
            </>
          )}
          {record.author && (
            <>
              {" "}
              · author {shortAddress(record.author)}
            </>
          )}
          <div>
            host: {record.hostStatus} · koinos: {record.koinosStatus}
          </div>
        </div>
      </details>
      <div className="row" style={{ marginTop: 8 }}>
        {explanation.actions.map((action) => (
          <button key={action} className={action === "confirm" ? "primary" : action === "discard" ? "danger" : ""} onClick={() => act(action)} disabled={busy}>
            {ACTION_LABEL[action]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Queue() {
  const { queue, loadQueue, run, busy, loadFeed } = usePanel();
  const [confirming, setConfirming] = useState<QueueItem | undefined>();
  const [audience, setAudience] = useState<number>(AUDIENCE.EVERYONE);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  if (confirming) {
    const hostNote = confirming.record.adapter === "facebook" ? "The Facebook post was submitted by you on Facebook; this only adds the Open Social copy." : undefined;
    return (
      <div>
        <div className="audience">
          {[AUDIENCE.EVERYONE, AUDIENCE.FRIENDS].map((value) => (
            <label key={value} className={audience === value ? "on" : ""}>
              <input type="radio" name="queue-audience" checked={audience === value} onChange={() => setAudience(value)} style={{ width: "auto", marginRight: 6 }} />
              {audienceName(value)}
            </label>
          ))}
        </div>
        <ConfirmSheet
          text={confirming.record.text ?? ""}
          audience={audience}
          hostNote={hostNote}
          busy={busy}
          onCancel={() => setConfirming(undefined)}
          onConfirm={async () => {
            await run(() => rpc("crosspost.confirm", { attemptId: confirming.record.attemptId, audience }));
            setConfirming(undefined);
            await loadQueue();
            void loadFeed("public", { refresh: true });
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted">Every attempt is tracked until both sides are known. Retries reuse the same key, so nothing is ever published twice.</span>
        <button onClick={() => loadQueue()}>Refresh</button>
      </div>
      {queue.length === 0 && <div className="muted">No cross-posts yet.</div>}
      {queue.map((item) => (
        <Item key={item.record.attemptId} item={item} onConfirm={setConfirming} />
      ))}
    </div>
  );
}
