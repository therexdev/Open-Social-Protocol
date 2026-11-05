import { useEffect, useRef, useState } from "react";
import { fromBase64url, musicCommentCipher, newEpochKey, randomBytes, toBase64url, type MusicRecord } from "@osp/sdk";
import { useServices } from "../../api/services";
import { useVault, useVaultStore } from "../../vault/context";
import { Button, Notice } from "../../components/ui";
import { submitAction } from "../../tx/submit";
import { useSubmitContext } from "../session";
import { MediaCapture, type CapturedMedia } from "../media/MediaCapture";
import { archiveClip, prepareClip } from "../media/clipArchive";
import { readingKey, trackContext } from "./musicAccessService";
import { encodeVoiceComment, restoreVoice, voiceCommentStore, type VoiceCommentDraft } from "./voiceComment";

export function VoiceCommentForm({ track, record, caption, replyTo, onPosted }:
  { track: string; record: MusicRecord; caption: string; replyTo?: string; onPosted: () => void }) {
  const { protocol } = useServices(), session = useVault(s => s.session), vault = useVaultStore(), submit = useSubmitContext();
  const [capture, setCapture] = useState<CapturedMedia>(), [draft, setDraft] = useState<VoiceCommentDraft>();
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const live = useRef(false), running = useRef(false);
  useEffect(() => {
    live.current = true;
    let cancelled = false;
    if (protocol && session) void voiceCommentStore(session, protocol, track).then(s => s.load()).then(value => {
      if (!cancelled) { setDraft(value); setReady(true); }
    }).catch(() => { if (!cancelled) setError("Could not open the voice draft on this browser. Reopen the track to try again."); });
    return () => { live.current = false; cancelled = true; };
  }, [protocol, session, track]);
  const check = () => {
    if (!live.current || vault.getState().session !== session) throw Error("Reopen this track with the same account to resume.");
  };
  const lockScope = `osp-voice-comment:${protocol?.chainId}:${protocol?.deployment.contracts.publications.address}:${track}:${session?.identity.account}`;
  const exclusive = async (action: () => Promise<void>) => {
    if (navigator.locks) await navigator.locks.request(lockScope, { ifAvailable: true }, async lock => {
      if (!lock) throw Error("Another tab is already saving this voice comment.");
      await action();
    });
    else await action();
  };
  const send = async () => {
    if (!protocol || !session || !submit || !ready || running.current || (!capture && !draft)) return;
    running.current = true; setBusy(true); setError("");
    try {
      await exclusive(async () => {
        const store = await voiceCommentStore(session, protocol, track);
        const existing = await store.load();
        if (existing && existing.id !== draft?.id) {
          check(); setDraft(existing);
          throw Error("This browser already has a saved voice comment. Resume or discard it first.");
        }
        // Recheck current reader eligibility before spending storage capacity.
        const key = await readingKey(protocol, track, record, session);
        let pending = draft;
        try {
          check();
          if (!pending && capture) {
            const voice = prepareClip({ bytes: new Uint8Array(await capture.file.arrayBuffer()), mime: capture.mime, durationMs: capture.durationMs }, "voice", protocol, !!record.encrypted);
            const plain = encodeVoiceComment(caption.trim(), voice), id = newEpochKey();
            const nonce = record.encrypted ? randomBytes(24) : undefined;
            if (nonce && !key) throw Error("Unlock the track to comment.");
            const body = nonce ? musicCommentCipher(trackContext(protocol, track, record.owner), key!, nonce, id, session.identity.account).encrypt(plain) : plain;
            pending = { id: toBase64url(id), body: toBase64url(body), ...(nonce && { nonce: toBase64url(nonce) }), replyTo,
              voice: { ...voice, contentHash: toBase64url(voice.contentHash) } };
            check(); await store.save(pending); check(); setDraft(pending);
          }
        } finally { key?.fill(0); }
        if (!pending) return;
        await archiveClip(restoreVoice(pending.voice), submit, session.identity.account, check);
        check();
        const op = await protocol.ops.publications.comment_music({ author: session.identity.account, id: fromBase64url(track),
          comment_id: fromBase64url(pending.id), body: fromBase64url(pending.body),
          ...(pending.nonce && { nonce: fromBase64url(pending.nonce) }), ...(pending.replyTo && { reply_to: fromBase64url(pending.replyTo) }) });
        await submitAction(submit, [op], { label: "Posting voice comment", beforeSubmit: async () => check() });
        await store.clear(); check(); setDraft(undefined); setCapture(undefined); onPosted();
      });
    } catch (e) { if (live.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { running.current = false; if (live.current) setBusy(false); }
  };
  const discard = async () => {
    if (!session || !protocol || running.current) return;
    try {
      await exclusive(async () => {
        const store = await voiceCommentStore(session, protocol, track);
        const current = await store.load();
        check();
        if (current && current.id !== draft?.id) { setDraft(current); throw Error("This draft changed in another tab."); }
        await store.clear(); check(); setDraft(undefined); setCapture(undefined);
      });
    }
    catch (e) { if (live.current) setError(e instanceof Error ? e.message : String(e)); }
  };
  return <div className="stack">
    {draft ? <Notice>Your voice comment is saved on this browser. Resume to finish posting the original recording and caption.</Notice> :
      <MediaCapture kind="voice" value={capture} onChange={setCapture} disabled={busy || !ready}/>}
    {error && <Notice kind="error">{error}</Notice>}
    {capture && !draft && <p className="hint">Voice storage uses {Math.ceil((capture.file.size + (record.encrypted ? 16 : 0))/32768)} usage units, plus the usual comment cost.</p>}
    <div className="row"><Button variant="primary" disabled={!ready || (!capture && !draft)} busy={busy} onClick={() => void send()}>{draft ? "Resume voice comment" : "Post voice comment"}</Button>
    {draft && <Button disabled={busy} onClick={() => void discard()}>Discard saved comment</Button>}</div>
  </div>;
}
