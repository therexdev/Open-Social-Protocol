import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { MusicRecord } from "@osp/sdk";
import { useServices } from "../../api/services";
import { Button, Notice } from "../../components/ui";
import { useVault } from "../../vault/context";
import { toArrayBuffer } from "../../util/bytes";
import { Icon } from "../../components/Icon";
import { MusicCover } from "./MusicCover";
import { musicDuration } from "./musicService";
import { playableMusic } from "./musicAccessService";
export const musicAudienceLabel = (record: MusicRecord) =>
  record.audience === 2 ? "Group" : record.audience === 1 ? "Friends" : "Public";
export function MusicTrack({
  id,
  record,
  expanded = false,
  playbackLocked = false,
}: {
  id: string;
  record: MusicRecord;
  expanded?: boolean;
  playbackLocked?: boolean;
}) {
  const { protocol } = useServices(),
    session = useVault((s) => s.session);
  const [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [percent, setPercent] = useState(0);
  const controller = useRef<AbortController | undefined>(undefined),
    blob = useRef("");
  useEffect(() => {
    setUrl("");
    setBusy(false);
    setError("");
    return () => {
      controller.current?.abort();
      if (blob.current) URL.revokeObjectURL(blob.current);
      blob.current = "";
    };
  }, [id, protocol, session, playbackLocked]);
  const load = async () => {
    if (!protocol || busy) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError("");
    try {
      const result = await playableMusic(protocol, id, session, c.signal, (n, total) =>
        setPercent(Math.floor((n / total) * 100))
      );
      if (c.signal.aborted) return;
      if (result.record.owner !== record.owner)
        throw new Error("Track ownership could not be verified.");
      blob.current = URL.createObjectURL(
        new Blob([toArrayBuffer(result.bytes)], { type: record.mime })
      );
      setUrl(blob.current);
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  };
  return (
    <article className={`music-track${expanded ? " music-track-expanded" : ""}`}>
      <MusicCover id={id} record={record}/>
      <div className="music-track-body">
      <div className="music-track-badges"><span><Icon name={record.audience ? "lock" : "globe"} size={13}/>{musicAudienceLabel(record)}</span><span>{BigInt(record.unlock_price ?? "0") > 0n ? `${Number(record.unlock_price).toLocaleString()} OSAT` : "Free to listen"}</span></div>
      <div className="music-track-copy">
        <h3>{expanded ? record.title : <Link to={`/music/${id}`}>{record.title}</Link>}</h3>
        {record.artist && <p className="music-artist">{record.artist}</p>}
        <p className="hint">
          {musicDuration(record.duration_ms)} · {(record.size / 1000000).toFixed(2)} MB
        </p>
        {record.description && (
          <p className={expanded ? "music-description" : "music-description music-excerpt"}>
            {record.description}
          </p>
        )}
      </div>
      <div className="music-track-actions">
      {url && !playbackLocked ? (
        <audio controls preload="metadata" src={url} aria-label={`Play ${record.title}`} />
       ) : playbackLocked ? (
        <p className="hint">Unlock access below to play this track.</p>
      ) : record.encrypted && !expanded ? (
        <Link className="btn btn-primary" to={`/music/${id}`}><Icon name="play" size={17}/>Listen / access</Link>
      ) : (
        <Button variant="primary" busy={busy} onClick={() => void load()}>
          {!busy && <Icon name="play" size={17}/>}
          {busy ? `Loading audio ${percent}%` : "Load & play"}
        </Button>
      )}
      {!expanded && <Link className="music-comment-link" title="Track & comments" aria-label="Track & comments" to={`/music/${id}`}><Icon name="message" size={16}/>Track & comments</Link>}
      </div>
      {error && (
        <Notice kind="error">
          {error}
          {record.encrypted && !expanded && (
            <>
              {" "}
              <Link to={`/music/${id}`}>Open access details</Link>
            </>
          )}
        </Notice>
      )}
      </div>
    </article>
  );
}
