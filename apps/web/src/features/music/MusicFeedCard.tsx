import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fromBase64url, toBase64url, type MusicRecord } from "@osp/sdk";
import type { MusicFeedView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Avatar, Icon } from "../../components/Icon";
import { useVault } from "../../vault/context";
import { useProfileName } from "../profile/useProfileName";
import { MusicTrack } from "./MusicTrack";

/** Indexer references are hints; fresh chain eligibility gates all track content. */
export function MusicFeedCard({ item }: { item: MusicFeedView }) {
  const { protocol } = useServices(), session = useVault(s => s.session);
  const scope = `${protocol?.chainId}:${protocol?.deployment.contracts.publications.address}:${item.trackId}:${session?.identity.account ?? "guest"}`;
  const [verified, setVerified] = useState<{ scope: string; session: typeof session; record: MusicRecord }>();
  useEffect(() => {
    setVerified(undefined); if (!protocol) return;
    let alive = true, running = false;
    const load = async () => {
      if (running) return; running = true;
      try {
        const id = fromBase64url(item.trackId);
        if (id.length !== 32 || toBase64url(id) !== item.trackId) throw Error("Invalid track reference");
        const record = (await protocol.reads.publications.get_music({ id }))?.value;
        if (!record || record.owner !== item.author || toBase64url(record.digest) !== item.contentHash || record.received !== record.chunk_hashes.length || !record.chunk_hashes.length) throw Error("Track unavailable");
        if (session) {
          if (!(await protocol.reads.publications.get_music_access({ id, buyer: session.identity.account }))?.eligible) throw Error("Not shared");
        } else if (record.audience !== 0) throw Error("Not public");
        if (alive) setVerified({ scope, session, record });
      } catch { if (alive) setVerified(undefined); }
      finally { running = false; }
    };
    void load(); const timer = setInterval(() => void load(), 30000);
    window.addEventListener("focus", load);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("focus", load); };
  }, [protocol, scope, session, item.author, item.contentHash]);
  if (!verified || verified.scope !== scope || verified.session !== session) return null;
  return <article className="post music-feed-post"><MusicFeedHeading owner={verified.record.owner}/><MusicTrack id={item.trackId} record={verified.record}/></article>;
}
function MusicFeedHeading({ owner }: { owner: string }) {
  const name = useProfileName(owner);
  return <header className="music-feed-heading"><Link to={`/u/${owner}`}><Avatar account={owner} name={name}/><span><strong>{name}</strong><small>Shared a track</small></span></Link><Icon name="music"/></header>;
}
