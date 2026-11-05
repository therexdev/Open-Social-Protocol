import { useCallback, useEffect, useRef, useState } from "react";
import { useServices } from "../../api/services";
import { Icon } from "../../components/Icon";
import { Button, Notice } from "../../components/ui";
import { MediaPhoto } from "../../components/MediaPhoto";
import { toArrayBuffer, toBase64url } from "../../util/bytes";
import { useVault } from "../../vault/context";
import type { MediaAttachment } from "../composer/publish";
import { loadClip } from "./clipArchive";
import { queueVideoPreview } from "./videoPoster";

type ClipPlayerProps = { media: MediaAttachment; verifyAccess?: () => Promise<void> };

export function ClipPlayer({ media, verifyAccess }: ClipPlayerProps) {
  const session = useVault(s => s.session);
  const { protocol } = useServices();
  const scope = [protocol?.chainId, session?.identity.account, media.url, toBase64url(media.contentHash), media.encryption?.nonce, media.videoPoster?.contentHash].join("/");
  return <VerifiedClipPlayer key={scope} media={media} verifyAccess={verifyAccess}/>;
}

function VerifiedClipPlayer({ media, verifyAccess }: ClipPlayerProps) {
  const { protocol } = useServices(), session = useVault(s => s.session);
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  const host = useRef<HTMLDivElement>(null), controller = useRef<AbortController | undefined>(undefined);
  const blob = useRef(""), playRequested = useRef(false), alive = useRef(true);
  const input = useRef({ media, verifyAccess }); input.current = { media, verifyAccess };
  const isVideo = media.mime.startsWith("video/"), permitted = !media.encryption || !!session;
  const poster = media.videoPoster;
  useEffect(() => {
    alive.current = true;
    setUrl(""); setBusy(false); setError(""); playRequested.current = false;
    return () => {
      alive.current = false; controller.current?.abort(); controller.current = undefined;
      if (blob.current) URL.revokeObjectURL(blob.current); blob.current = "";
    };
  }, [protocol, session]);
  useEffect(() => {
    if (!isVideo || !host.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)), { rootMargin: "150px" });
    observer.observe(host.current); return () => observer.disconnect();
  }, [isVideo]);
  const load = useCallback(async (play = true) => {
    if (!protocol || !alive.current || (input.current.media.encryption && !session)) return;
    if (play) playRequested.current = true;
    if (controller.current || blob.current) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError("");
    try {
      await input.current.verifyAccess?.();
      if (request.signal.aborted) return;
      const bytes = await loadClip(input.current.media, protocol, request.signal);
      if (request.signal.aborted) return;
      blob.current = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: input.current.media.mime }));
      setUrl(blob.current);
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (controller.current === request) controller.current = undefined;
      if (alive.current) setBusy(false);
    }
  }, [protocol, session]);
  useEffect(() => {
    // New clips show their small archived frame. Older clips load into a paused
    // player near the viewport, with two passive downloads at most.
    if (!isVideo || !visible || poster || !permitted || url || error) return;
    let cancelled = false;
    void queueVideoPreview(async () => { if (!cancelled) await load(false); });
    return () => {
      cancelled = true;
      if (!playRequested.current) controller.current?.abort();
    };
  }, [isVideo, visible, !!poster, permitted, url, error, load]);
  const title = media.altText || (isVideo ? "Video" : "Voice message");
  return <div className={`clip-player${isVideo ? " clip-video" : ""}`} ref={host}>
    {url && permitted ? (
      isVideo ? <video src={url} controls autoPlay={playRequested.current} playsInline preload="auto" aria-label={title}
        onLoadedData={event => { if (!playRequested.current && event.currentTarget.currentTime === 0) event.currentTarget.currentTime = 0.01; }}/>
        : <audio src={url} controls autoPlay preload="metadata" aria-label={title}/>
    ) : isVideo ? <div className="video-preview">
      {visible && poster && permitted && <MediaPhoto location={poster.url} hash={poster.contentHash} mime={poster.mime} encryption={poster.encryption} alt={media.altText || "Video preview"}/>}
      <button type="button" className="video-preview-play" disabled={!protocol || !permitted} onClick={() => void load()} aria-label={busy ? "Loading video" : "Play video"}>
        <span className="video-play-icon">{busy ? <span className="spinner"/> : <Icon name="play" size={32}/>}</span>
        <span>{!permitted ? "Unlock to view video" : busy ? "Loading video…" : "Play video"}</span>
      </button>
    </div> : <Button variant="ghost" busy={busy} disabled={!protocol || !permitted} onClick={() => void load()}>
      <Icon name="play"/>{busy ? "Loading…" : "Play voice message"}
    </Button>}
    {error && <Notice kind="error">{error}</Notice>}
  </div>;
}
