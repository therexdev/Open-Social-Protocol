import { useEffect, useState, type ReactNode } from "react";
import { contentHash, fromBase64url, musicEngagementId, toBase64url, type MusicRecord, type MusicComment } from "@osp/sdk";
import { Link } from "react-router-dom";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Icon } from "../../components/Icon";
import { ReactionPicker } from "../feed/ReactionPicker";
import { useMe } from "../session";
import { PostEconomyActions } from "../tokens/PostEconomyActions";

export function MusicEngagement({ id, record, expanded = false, locked = false, comment, children }: { id: string; record: MusicRecord; expanded?: boolean; locked?: boolean; comment?: MusicComment; children?: ReactNode }) {
  const { indexer } = useServices(), me = useMe();
  const commentId = comment ? toBase64url(comment.id) : undefined;
  const [version, setVersion] = useState(0);
  const [summary, setSummary] = useState<Pick<PostView, "economy" | "reactions">>();
  useEffect(() => {
    let alive = true;
    setSummary(undefined);
    if (indexer.configured) void indexer.musicEngagement(id, me?.account, commentId).then(s => { if (alive) setSummary(s); }).catch(() => {});
    return () => { alive = false; };
  }, [id, indexer, me?.account, version, commentId]);
  const key = toBase64url(musicEngagementId(fromBase64url(id), comment?.id));
  const refresh = () => setVersion(v => v + 1);
  const post = { postId: key, author: comment?.author ?? record.owner, audience: record.audience ?? 0, contentHash: toBase64url(comment ? contentHash(comment.body) : record.digest), state: comment?.deleted ? 2 : locked ? 1 : 0, economy: summary?.economy };
  return <PostEconomyActions song post={post} onChanged={refresh}>
    {!comment?.deleted && <ReactionPicker id={key} disabled={locked} reactions={summary?.reactions ?? { total: 0, byType: {} }} onChanged={refresh}/>}
    {comment ? children : expanded
      ? <a className="btn btn-ghost engagement-icon" href="#track-comments" aria-label="Track comments" title="Comments"><Icon name="message" size={18}/></a>
      : <Link className="btn btn-ghost engagement-icon" to={`/music/${id}#track-comments`} aria-label="Track comments" title="Comments"><Icon name="message" size={18}/></Link>}
  </PostEconomyActions>;
}
