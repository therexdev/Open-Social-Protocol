import { useEffect, useState } from "react";
import type { PollView } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Button, Notice } from "../../components/ui";
import { useCanAct, useSubmitContext } from "../session";
import { submitAction } from "../../tx/submit";
import { bytesOf } from "../../util/bytes";
import { errorMessage } from "../../util/format";
import { RichText } from "../../components/RichText";

export function PollCard({ post, onChanged }: { post: PostView; onChanged?: () => void }) {
  const { protocol } = useServices(), submit = useSubmitContext(), can = useCanAct();
  const viewer = submit?.signer.getAddress();
  const [view, setView] = useState<PollView>();
  const [selected, setSelected] = useState<number>();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    let active = true;
    setView(undefined); setSelected(undefined);
    const read = async () => {
      if (!protocol) return;
      try {
        const current = await protocol.reads.publications.get_poll({ post_id: bytesOf(post.postId), ...(viewer && { viewer }) });
        if (active) { setView(current); setClock(Date.now()); setError(undefined); }
      } catch (e) { if (active) setError(errorMessage(e)); }
    };
    void read();
    const timer = setInterval(() => void read(), 15000);
    return () => { active = false; clearInterval(timer); };
  }, [protocol, post.postId, viewer]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const poll = view?.value ?? post.poll;
  if (!poll) return null;
  const closed = Math.max(clock, Number(view?.now ?? 0)) >= Number(poll.definition.closes_at);
  const current = selected ?? view?.ballot?.option;
  const answer = async () => {
    if (!submit || !can.ok || busy || !view?.value || current === undefined || closed) return;
    setBusy(true); setError(undefined);
    try {
      const op = await submit.client.ops.publications.answer_poll({ actor: submit.signer.getAddress(), post_id: bytesOf(post.postId), option: current });
      await submitAction(submit, [op], { label: "Recording your poll answer", success: "Answer recorded. Your upvote or downvote is unchanged." });
      setView(await submit.client.reads.publications.get_poll({ post_id: bytesOf(post.postId), viewer: submit.signer.getAddress() }));
      setSelected(undefined); onChanged?.();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <section className="poll-card" aria-label="Poll">
    <h3><RichText text={poll.definition.question}/></h3>
    <fieldset disabled={busy || closed || !can.ok || !view?.value}><legend>Choose one answer</legend>
      {poll.definition.options.map((option, i) => {
        const count = poll.counts[i] ?? 0, percent = poll.participants ? Math.round(count * 100 / poll.participants) : 0;
        return <label className="poll-option" key={i}><span className="poll-option-label"><input type="radio" name={`poll-${post.postId}`} checked={current === i} onChange={() => setSelected(i)}/><span>{option}</span><span>{percent}% · {count}</span></span><progress value={count} max={Math.max(1, poll.participants)} aria-label={`${option}: ${count} answers`}/></label>;
      })}
    </fieldset>
    <p className="hint">{poll.participants} answers · {closed ? "Closed" : `Closes ${new Date(Number(poll.definition.closes_at)).toLocaleString()}`} · {(Number(poll.engagement_milli) / 1000).toFixed(3)} engagement</p>
    <p className="hint">Answers are public. Participation is separate from upvotes and downvotes; changing your answer adds no extra engagement.</p>
    {!closed && <Button variant="primary" busy={busy} disabled={!can.ok || !view?.value || current === undefined || current === view?.ballot?.option} onClick={() => void answer()}>{view?.ballot ? "Change answer" : "Submit answer"}</Button>}
    {!can.ok && <p className="hint">{can.reason}</p>}
    {error && <Notice kind="error">{error}</Notice>}
  </section>;
}
