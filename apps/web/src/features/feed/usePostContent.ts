/** Opens a PostView for display through the session key store (decryption on the device). */
import { useEffect, useState } from "react";
import { openPost, type PostContent } from "../../api/decrypt";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { useSession } from "../session";

export function usePostContent(post: PostView): PostContent | undefined {
  const { resolved, indexer } = useServices();
  const session = useSession();
  const [content, setContent] = useState<PostContent | undefined>(undefined);
  const chainId = resolved.chainId ?? "";
  useEffect(() => {
    let cancelled = false;
    setContent(undefined);
    const me = session ? { account: session.identity.account, seed: session.identity.seed, encryption: session.identity.encryption } : undefined;
    void openPost(post, {
      chainId,
      ...(session && { keys: session.keys }),
      ...(me && { me }),
      ...(indexer.configured && { keySource: indexer }),
    }).then((result) => {
      if (!cancelled) setContent(result);
    });
    return () => {
      cancelled = true;
    };
  }, [post.postId, post.contentHash, post.state, chainId, session, indexer]);
  return content;
}
