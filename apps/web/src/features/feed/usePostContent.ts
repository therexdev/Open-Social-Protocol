/** Opens a PostView for display through the session key store (decryption on the device). */
import { useEffect, useMemo, useState } from "react";
import { openPost, type PostContent } from "../../api/decrypt";
import { chainKeyVerifier } from "../../api/keyProvenance";
import type { PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { useSession } from "../session";

export function usePostContent(post: PostView): PostContent | undefined {
  const { resolved, indexer, protocol } = useServices();
  const session = useSession();
  const [content, setContent] = useState<PostContent | undefined>(undefined);
  const chainId = resolved.chainId ?? "";
  // Sealed keys from the indexer are trusted only once their distribute_keys transaction is found on chain.
  const verify = useMemo(() => (protocol ? chainKeyVerifier(protocol) : undefined), [protocol]);
  useEffect(() => {
    let cancelled = false;
    setContent(undefined);
    const me = session ? { account: session.identity.account, seed: session.identity.seed, encryption: session.identity.encryption } : undefined;
    void openPost(post, {
      chainId,
      ...(session && { keys: session.keys }),
      ...(me && { me }),
      ...(indexer.configured && { keySource: indexer }),
      ...(verify && { verify }),
    }).then((result) => {
      if (!cancelled) setContent(result);
    });
    return () => {
      cancelled = true;
    };
  }, [post.postId, post.contentHash, post.state, chainId, session, indexer, verify]);
  return content;
}
