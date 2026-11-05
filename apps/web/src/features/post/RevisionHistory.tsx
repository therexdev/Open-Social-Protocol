import { useState } from "react";
import type { PostVersionView, PostView } from "../../api/indexer";
import { Button } from "../../components/ui";
import { formatDateTime } from "../../util/format";
import { PostBody } from "../feed/PostCard";
import { usePostContent } from "../feed/usePostContent";

function RevisionBody({post, version}: {post: PostView; version: PostVersionView}) {
  const content = usePostContent(post, version);
  return <PostBody content={content} />;
}

export function RevisionHistory({ post, initiallyOpen }: { post: PostView; initiallyOpen: boolean }) {
  const [selected, setSelected] = useState<number>();
  return (
    <details className="details" open={initiallyOpen || undefined} onToggle={event => {
      if (!event.currentTarget.open) setSelected(undefined);
    }}>
      <summary>Revision history ({post.versionNumber})</summary>
      <ol className="details-body list">
        {[...post.versions].reverse().map(version => (
          <li key={version.versionNumber}>
            <Button variant="ghost" aria-expanded={selected === version.versionNumber}
              onClick={() => setSelected(current => current === version.versionNumber ? undefined : version.versionNumber)}>
              Version {version.versionNumber}{version.versionNumber === post.versionNumber ? " (current)" : ""} · {formatDateTime(version.timestamp)}
            </Button>
            {selected === version.versionNumber && <RevisionBody post={post} version={version} />}
          </li>
        ))}
      </ol>
    </details>
  );
}
