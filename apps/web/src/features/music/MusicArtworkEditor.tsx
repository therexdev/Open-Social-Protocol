import { useEffect, useRef, useState } from "react";
import { fromBase64url, type MusicRecord } from "@osp/sdk";
import { useServices } from "../../api/services";
import { Button, Card, Notice } from "../../components/ui";
import { useVault, useVaultStore } from "../../vault/context";
import { useSubmitContext } from "../session";
import { readingKey } from "./musicAccessService";
import { artworkDraftStore, prepareMusicArtwork, saveMusicArtwork, supportsMusicArt, type MusicArtworkDraft } from "./musicArtwork";
import { MusicArtworkPicker } from "./MusicArtworkPicker";

export function MusicArtworkEditor({ id, record, onSaved }: { id: string; record: MusicRecord; onSaved: () => Promise<void> }) {
  const { protocol } = useServices(), session = useVault(s => s.session), vault = useVaultStore(), submit = useSubmitContext();
  const [selecting, setSelecting] = useState(false);
  const [supported, setSupported] = useState(false), [bytes, setBytes] = useState<Uint8Array>();
  const [pending, setPending] = useState<{ artwork: MusicArtworkDraft; revision: number }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const alive = useRef(true), running = useRef(false);
  useEffect(() => {
    alive.current = true; let cancelled = false;
    if (protocol && session) void (async () => {
      const supported = await supportsMusicArt(protocol), store = await artworkDraftStore(session, protocol, id), saved = await store.load();
      if (!cancelled) { setSupported(supported); setPending(saved); }
    })().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; alive.current = false; };
  }, [protocol, session, id]);
  const save = async () => {
    if (!protocol || !session || !submit || running.current || (!pending && !bytes)) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    const lease = vault.getState().keepUnlocked();
    const assertActive = () => { if (!alive.current || vault.getState().session !== session) throw Error("Artwork paused. Unlock your account and resume."); lease.renew(); };
    let secret: Uint8Array | undefined;
    try {
      const store = await artworkDraftStore(session, protocol, id);
      let draft = pending;
      if (!draft) {
        if (record.audience !== 0) secret = await readingKey(protocol, id, record, session);
        draft = { artwork: prepareMusicArtwork(protocol, fromBase64url(id), record.owner, record.audience ?? 0, bytes!, secret), revision: record.cover_revision ?? 0 };
        assertActive(); await store.save(draft); if (alive.current) setPending(draft);
      }
      await saveMusicArtwork(submit, id, record.owner, draft.artwork, draft.revision, assertActive);
      assertActive(); await store.clear(); setPending(undefined); setBytes(undefined); setNotice("Track artwork saved."); await onSaved();
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { secret?.fill(0); lease.release(); running.current = false; if (alive.current) setBusy(false); }
  };
  if (!supported || session?.identity.account !== record.owner) return null;
  return <Card title="Track artwork">
    <p className="hint">Add or change the cover without uploading or paying for the audio again. Artwork uses the same photo usage allowance as other images.</p>
    {!pending ? <MusicArtworkPicker value={bytes} onChange={setBytes} disabled={busy} privateArt={record.audience !== 0} onBusyChange={setSelecting}/> : <Notice>Your artwork upload is saved. Resume to finish without uploading confirmed image chunks again.</Notice>}
    <div className="row wrap"><Button variant="primary" busy={busy} disabled={selecting || !submit || (!bytes && !pending)} onClick={() => void save()}>{pending ? "Resume artwork" : "Save artwork"}</Button>
      {pending && !busy && <Button variant="ghost" onClick={() => {
        if (window.confirm("Forget this artwork draft? Any photo usage already consumed is not returned.")) void artworkDraftStore(session!, protocol!, id).then(s => s.clear()).then(() => { setPending(undefined); setBytes(undefined); setError(""); }).catch(e => setError(String(e)));
      }}>Discard artwork draft</Button>}
    </div>
    {error && <Notice kind="error">{error}</Notice>}{notice && <Notice kind="success">{notice}</Notice>}
  </Card>;
}
