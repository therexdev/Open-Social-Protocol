import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { MusicRecord } from "@osp/sdk";
import { useServices } from "../../api/services";
import { Button, Notice } from "../../components/ui";
import { useVault } from "../../vault/context";
import { toArrayBuffer } from "../../util/bytes";
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
  }, [id, protocol, session]);
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
    <article className="music-track">
      <div>
        <h3>{expanded ? record.title : <Link to={`/music/${id}`}>{record.title}</Link>}</h3>
        {record.artist && <p className="music-artist">{record.artist}</p>}
        <p className="hint">
          {musicDuration(record.duration_ms)} · {(record.size / 1000000).toFixed(2)} MB ·{" "}
          {musicAudienceLabel(record)}
          {BigInt(record.unlock_price ?? "0") > 0n
            ? ` · ${Number(record.unlock_price).toLocaleString()} OSAT to unlock`
            : ""}
        </p>
        {record.description && (
          <p className={expanded ? "music-description" : "music-description music-excerpt"}>
            {record.description}
          </p>
        )}
      </div>
      {url ? (
        <audio controls preload="metadata" src={url} aria-label={`Play ${record.title}`} />
      ) : playbackLocked ? (
        <p className="hint">Unlock access below to play this track.</p>
      ) : (
        <Button busy={busy} onClick={() => void load()}>
          {busy ? `Loading audio ${percent}%` : "Load & play"}
        </Button>
      )}
      {!expanded && <Link to={`/music/${id}`}>Open track & comments</Link>}
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
    </article>
  );
}
