import { useId, useState } from "react";
import type { PostVersionView, PostView } from "../../api/indexer";
import { Button } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { formatDateTime } from "../../util/format";
import { PostBody } from "../feed/PostCard";
import { usePostContent } from "../feed/usePostContent";

function RevisionBody({post, version}: {post: PostView; version: PostVersionView}) {
  const content = usePostContent(post, version);
  return <PostBody content={content} expanded />;
}

export function RevisionHistory({ post, initiallyOpen }: { post: PostView; initiallyOpen: boolean }) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  const [selected, setSelected] = useState<number>();
  const id = useId();
  return (
    <section className="revision-history" aria-label="Revision history">
      <Button className="revision-history-toggle" aria-expanded={expanded} aria-controls={`${id}-list`} onClick={() => {
        setExpanded(value => !value);
        setSelected(undefined);
      }}>
        <Icon name="layers" size={18}/> Revision history
        <span className="revision-count">{post.versionNumber}</span>
        <Icon name="chevron" size={16} className="revision-chevron"/>
      </Button>
      <ol className="revision-list" id={`${id}-list`} hidden={!expanded}>
        {[...post.versions].reverse().map(version => {
          const open = selected === version.versionNumber;
          const panelId = `${id}-version-${version.versionNumber}`;
          return <li key={version.versionNumber} className={`revision-item${open ? " is-open" : ""}`}>
            <Button className="revision-toggle" aria-expanded={open} aria-controls={panelId} id={`${panelId}-toggle`}
              onClick={() => setSelected(current => current === version.versionNumber ? undefined : version.versionNumber)}>
              <span className="revision-labels">
                <span className="revision-title">Version {version.versionNumber}{version.versionNumber === post.versionNumber && <span className="revision-current">Current</span>}</span>
                <span className="revision-timestamp">{formatDateTime(version.timestamp)}</span>
              </span>
              <Icon name="chevron" size={18} className="revision-chevron"/>
            </Button>
            {open && <div className="revision-body" id={panelId} role="region" aria-labelledby={`${panelId}-toggle`}><RevisionBody post={post} version={version} /></div>}
          </li>;
        })}
      </ol>
    </section>
  );
}
