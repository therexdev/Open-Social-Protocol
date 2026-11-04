import { useEffect, useRef, useState } from "react";
import type { MusicRecord } from "@osp/sdk";
import { toBase64url } from "@osp/sdk";
import { useServices } from "../../api/services";
import { Icon } from "../../components/Icon";
import { useVault } from "../../vault/context";
import { loadMusicArtwork } from "./musicArtwork";

export function MusicCover({ id, record }: { id: string; record: MusicRecord }) {
  const services = useServices(), session = useVault(s => s.session), host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false), [image, setImage] = useState<{ identity: string; url: string; session: typeof session }>();
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const identity = `${id}:${record.cover ? toBase64url(record.cover.photo_id) : ""}:${record.cover_revision ?? 0}`;
  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "300px" });
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setImage(undefined); setFailed(false);
    if (!record.cover || !visible || (record.cover.encrypted && !session)) return;
    const controller = new AbortController(); let url = "", running = false;
    const load = async () => {
      if (running) return; running = true;
      try {
        const bytes = await loadMusicArtwork(services, id, record, session, controller.signal);
        if (controller.signal.aborted) return;
        const next = URL.createObjectURL(new Blob([bytes.slice()], { type: record.cover!.mime }));
        if (url) URL.revokeObjectURL(url); url = next;
        setImage({ identity, url, session }); setFailed(false);
      } catch { if (!controller.signal.aborted) { setImage(undefined); setFailed(true); if (url) URL.revokeObjectURL(url); url = ""; } }
      finally { running = false; }
    };
    void load();
    const timer = record.cover.encrypted ? setInterval(() => void load(), 30000) : undefined;
    return () => { controller.abort(); clearInterval(timer); if (url) URL.revokeObjectURL(url); };
  }, [identity, services, session, visible, retry]);
  const url = image?.identity === identity && (!record.cover?.encrypted || image.session === session) ? image.url : undefined;
  return <div ref={host} className={`music-cover ${url ? "has-art" : "music-cover-placeholder"}`}>
    {url ? <img src={url} alt={`Cover for ${record.title}`} decoding="async" onError={() => { setImage(undefined); setFailed(true); }}/> : <><span className="music-cover-orbit"/><Icon name="music" size={40}/><span>{record.cover?.encrypted ? "Private artwork" : "OPEN SOCIAL · MUSIC"}</span></>}
    {failed && !record.cover?.encrypted && <button type="button" className="music-cover-retry" onClick={() => setRetry(n => n + 1)}>Retry artwork</button>}
  </div>;
}
