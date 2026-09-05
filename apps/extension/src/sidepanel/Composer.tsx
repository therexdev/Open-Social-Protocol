import { useEffect, useState } from "react";
import { AUDIENCE } from "@osp/sdk";
import type { QueueItem } from "../background/app";
import { measureDraft } from "../shared/draft";
import { audienceName } from "../shared/format";
import { MAX_POST_CHARS, type PageInfo } from "../shared/protocol";
import { rpc } from "../shared/rpc";
import { usePanel } from "./store";

/** The explicit confirmation surface: audience + permanence, rendered by the extension. */
export function ConfirmSheet({ text, audience, hostNote, onConfirm, onCancel, busy }: { text: string; audience: number; hostNote?: string; onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <div className="card confirm">
      <h2>Publish to {audienceName(audience)}?</h2>
      <div className="post">
        <div className="text">{text}</div>
      </div>
      <ul>
        <li>
          <strong>Permanent.</strong> The post is recorded on the Koinos blockchain. You can hide or mark it deleted later, but copies already delivered cannot be erased.
        </li>
        {audience === AUDIENCE.FRIENDS ? (
          <li>
            <strong>Friends only.</strong> Encrypted with your current friends key. Removing a friend later blocks future keys; it cannot take back what they already received.
          </li>
        ) : (
          <li>
            <strong>Everyone.</strong> Stored in the clear; anyone can read it, forever.
          </li>
        )}
        {hostNote && <li>{hostNote}</li>}
      </ul>
      <div className="row end">
        <button onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="primary" onClick={onConfirm} disabled={busy}>
          {busy ? "Publishing…" : "Confirm and publish"}
        </button>
      </div>
    </div>
  );
}

export function Composer() {
  const { run, busy, prefill, setPrefill, loadQueue, setTab, status, loadFeed } = usePanel();
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<number>(AUDIENCE.EVERYONE);
  const [url, setUrl] = useState<string | undefined>();
  const [title, setTitle] = useState<string | undefined>();
  const [review, setReview] = useState<QueueItem | undefined>();
  const [pageMessage, setPageMessage] = useState<string | undefined>();

  useEffect(() => {
    if (prefill) {
      setText(prefill.text);
      setUrl(prefill.url);
      setTitle(prefill.title);
      setPrefill(undefined);
    }
  }, [prefill, setPrefill]);

  async function sharePage() {
    const info = await run(() => rpc<PageInfo>("page.current"));
    if (!info) return;
    if (!info.url) {
      setPageMessage(info.message ?? "No page to share.");
      return;
    }
    setPageMessage(undefined);
    setUrl(info.url);
    setTitle(info.title);
    if (text.trim().length === 0) setText(info.title ?? info.url);
  }

  async function reviewDraft() {
    const item = await run(() =>
      rpc<QueueItem>("crosspost.create", { text: text.trim(), audience, adapter: url ? "generic" : "sidepanel", ...(url && { url }), ...(title && { title }) }),
    );
    if (item) setReview(item);
  }

  async function confirm() {
    if (!review) return;
    const item = await run(() => rpc<QueueItem>("crosspost.confirm", { attemptId: review.record.attemptId, audience }));
    await loadQueue();
    if (item) {
      setReview(undefined);
      setText("");
      setUrl(undefined);
      setTitle(undefined);
      void loadFeed("public", { refresh: true });
      setTab("queue");
    }
  }

  async function cancelReview() {
    if (review) await run(() => rpc("crosspost.discard", { attemptId: review.record.attemptId }));
    setReview(undefined);
    await loadQueue();
  }

  const canPublish = status?.deviceAuthorized && status.network.deployed;
  // The chain limit is the encoded envelope (bytes), not characters: measure the draft as it will be published.
  const size = measureDraft(text, url);

  if (review) {
    return (
      <ConfirmSheet
        text={review.record.text ?? text}
        audience={audience}
        hostNote={url ? `The post links to ${url} as its external reference.` : undefined}
        onConfirm={confirm}
        onCancel={cancelReview}
        busy={busy}
      />
    );
  }

  return (
    <div className="card">
      <h2>New post</h2>
      {!canPublish && <div className="notice">{status?.network.deployed ? "Authorize this browser to publish." : status?.network.message}</div>}
      <textarea value={text} maxLength={MAX_POST_CHARS} onChange={(e) => setText(e.target.value)} placeholder="What do you want to share?" />
      <div className={size.ok ? "muted" : "error"} style={{ textAlign: "right" }}>
        {size.bytes}/{size.limit} bytes{!size.ok && ` · ${size.bytes - size.limit} over the limit: shorten the text${url ? " or remove the link" : ""}`}
      </div>
      <div className="audience">
        {[AUDIENCE.EVERYONE, AUDIENCE.FRIENDS].map((value) => (
          <label key={value} className={audience === value ? "on" : ""}>
            <input type="radio" name="audience" checked={audience === value} onChange={() => setAudience(value)} style={{ width: "auto", marginRight: 6 }} />
            {audienceName(value)}
          </label>
        ))}
      </div>
      {url && (
        <div className="notice">
          Sharing <span className="ref">{url}</span>{" "}
          <button
            className="link"
            onClick={() => {
              setUrl(undefined);
              setTitle(undefined);
            }}
          >
            remove
          </button>
        </div>
      )}
      {pageMessage && <div className="notice">{pageMessage}</div>}
      <div className="row">
        <button onClick={sharePage} disabled={busy}>
          Share current page
        </button>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={reviewDraft} disabled={busy || !canPublish || text.trim().length === 0 || !size.ok}>
          Review…
        </button>
      </div>
    </div>
  );
}
