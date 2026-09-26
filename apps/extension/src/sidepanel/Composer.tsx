import { useEffect, useRef, useState } from "react";
import { AUDIENCE } from "@osp/sdk";
import type { QueueItem } from "../background/app";
import { measureDraft } from "../shared/draft";
import { MAX_POST_CHARS, type PageInfo } from "../shared/protocol";
import { rpc } from "../shared/rpc";
import { usePanel } from "./store";

export function Composer() {
  const { run, busy, prefill, setPrefill, loadQueue, status, loadFeed } = usePanel();
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<number>(AUDIENCE.EVERYONE);
  const [url, setUrl] = useState<string | undefined>();
  const [title, setTitle] = useState<string | undefined>();
  const [pageMessage, setPageMessage] = useState<string | undefined>();
  const [result, setResult] = useState<string>();
  const attempt = useRef<{ id: string; draft: string; existing?: boolean } | undefined>(undefined);
  const publishing = useRef(false);

  useEffect(() => {
    if (prefill) {
      setText(prefill.text); setUrl(prefill.url); setTitle(prefill.title);
      setAudience(prefill.audience ?? AUDIENCE.EVERYONE);
      attempt.current = prefill.attemptId ? { id: prefill.attemptId, draft: "", existing: true } : undefined;
      setResult(undefined); setPrefill(undefined);
    }
  }, [prefill, setPrefill]);

  async function sharePage() {
    const info = await run(() => rpc<PageInfo>("page.current"));
    if (!info) return;
    if (!info.url) { setPageMessage(info.message ?? "No page to share."); return; }
    setPageMessage(undefined); setUrl(info.url); setTitle(info.title);
    if (!text.trim()) setText(info.title ?? info.url);
  }

  async function publish() {
    if (publishing.current) return;
    publishing.current = true;
    setResult(undefined);
    try {
      const draft = JSON.stringify({ text: text.trim(), audience, url, title });
      if (!attempt.current?.existing && attempt.current?.draft !== draft) attempt.current = { id: Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""), draft };
      const current = attempt.current!;
      const item = await run(() => current.existing
        ? rpc<QueueItem>("crosspost.confirm", { attemptId: current.id, audience })
        : rpc<QueueItem>("post.publish", { attemptId: current.id, text: text.trim(), audience, adapter: url ? "generic" : "sidepanel", ...(url && { url }), ...(title && { title }) }));
      await loadQueue();
      if (!item) return;
      if (item.record.koinosStatus === "ok") {
        setResult(`Published to ${audience === AUDIENCE.FRIENDS ? "Friends" : "Public"}.`);
        setText(""); setUrl(undefined); setTitle(undefined); attempt.current = undefined;
        void loadFeed(audience === AUDIENCE.FRIENDS ? "friends" : "public", { refresh: true });
      } else {
        setResult(item.record.koinosStatus === "failed" ? `Could not publish: ${item.record.lastError || "Try again below."}` : "Confirming your post. Its status will update below; you do not need to post again.");
        // Persisted attempts are recovered below with the same key, including after panel closure.
        setText(""); setUrl(undefined); setTitle(undefined); attempt.current = undefined;
      }
    } finally { publishing.current = false; }
  }

  const canPublish = status?.deviceAuthorized && status.network.deployed;
  const size = measureDraft(text, url);
  return <div className="card">
    <h2>New post</h2>
    {!canPublish && <div className="notice">{status?.network.deployed ? "Authorize this browser to publish." : status?.network.message}</div>}
    <textarea value={text} disabled={busy || attempt.current?.existing} maxLength={MAX_POST_CHARS} onChange={e => setText(e.target.value)} placeholder="What do you want to share?" />
    <div className={size.ok ? "muted" : "error"} style={{ textAlign: "right" }}>{size.bytes}/{size.limit} bytes{!size.ok && " · Shorten your post."}</div>
    <div className="audience">
      {[AUDIENCE.EVERYONE, AUDIENCE.FRIENDS].map(value => <label key={value} className={audience === value ? "on" : ""}>
        <input type="radio" name="audience" disabled={busy} checked={audience === value} onChange={() => setAudience(value)} style={{ width: "auto", marginRight: 6 }} />
        {value === AUDIENCE.FRIENDS ? "Friends" : "Public"}
      </label>)}
    </div>
    <p className="muted">{audience === AUDIENCE.FRIENDS ? "Encrypted for your friends. Copies already received cannot be taken back." : "Anyone can read this post. Published copies are permanent."}</p>
    {url && <div className="notice">Sharing <span className="ref">{url}</span> <button className="link" disabled={busy || attempt.current?.existing} onClick={() => { setUrl(undefined); setTitle(undefined); }}>remove</button></div>}
    {pageMessage && <div className="notice">{pageMessage}</div>}
    {result && <div role="status" className="notice">{result}</div>}
    <div className="row">
      <button onClick={sharePage} disabled={busy || attempt.current?.existing}>Share current page</button>
      <span style={{ flex: 1 }} />
      <button className="primary" onClick={publish} disabled={busy || !canPublish || !text.trim() || !size.ok}>{busy ? "Publishing…" : audience === AUDIENCE.FRIENDS ? "Post to Friends" : "Post publicly"}</button>
    </div>
  </div>;
}
