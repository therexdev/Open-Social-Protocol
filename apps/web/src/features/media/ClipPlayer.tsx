import { useEffect, useRef, useState } from "react";
import { useServices } from "../../api/services";
import { Icon } from "../../components/Icon";
import { Button, Notice } from "../../components/ui";
import { toArrayBuffer, toBase64url } from "../../util/bytes";
import { useVault } from "../../vault/context";
import type { MediaAttachment } from "../composer/publish";
import { loadClip } from "./clipArchive";

type ClipPlayerProps = { media: MediaAttachment; verifyAccess?: () => Promise<void> };

export function ClipPlayer({ media, verifyAccess }: ClipPlayerProps) {
  const session = useVault(s => s.session);
  const { protocol } = useServices();
  const scope = [protocol?.chainId, session?.identity.account, media.url, toBase64url(media.contentHash), media.encryption?.nonce].join("/");
  return <VerifiedClipPlayer key={scope} media={media} verifyAccess={verifyAccess}/>;
}

function VerifiedClipPlayer({ media, verifyAccess }: ClipPlayerProps) {
  const { protocol } = useServices();
  const session = useVault(s => s.session);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  const blob = useRef("");
  const isVideo = media.mime.startsWith("video/");
  useEffect(() => {
    setUrl("");
    setBusy(false);
    setError("");
    return () => {
      controller.current?.abort();
      controller.current = undefined;
      if (blob.current) URL.revokeObjectURL(blob.current);
      blob.current = "";
    };
  }, [protocol, session]);
  const load = async () => {
    if (!protocol || controller.current || (media.encryption && !session)) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    try {
      await verifyAccess?.();
      if (request.signal.aborted) return;
      const bytes = await loadClip(media, protocol, request.signal);
      if (request.signal.aborted) return;
      blob.current = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: media.mime }));
      setUrl(blob.current);
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!request.signal.aborted) { controller.current = undefined; setBusy(false); }
    }
  };
  const title = media.altText || (isVideo ? "Video" : "Voice message");
  return <div className="clip-player">
    {url && (!media.encryption || session) ? (
      isVideo ? <video src={url} controls autoPlay playsInline preload="metadata" aria-label={title}/> :
        <audio src={url} controls autoPlay preload="metadata" aria-label={title}/>
    ) : <Button variant="ghost" busy={busy} disabled={!protocol || (!!media.encryption && !session)} onClick={() => void load()}>
      <Icon name="play"/>{busy ? "Loading…" : isVideo ? "Play video" : "Play voice message"}
    </Button>}
    {error && <Notice kind="error">{error}</Notice>}
  </div>;
}
