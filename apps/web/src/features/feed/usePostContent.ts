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
    let timer: number | undefined;
    setContent(undefined);
    const me = session ? { account: session.identity.account, seed: session.identity.seed, encryption: session.identity.encryption } : undefined;
    const open = async () => {
      const result = await openPost(post, {
        chainId,
        ...(session && { keys: session.keys }),
        ...(me && { me }),
        ...(indexer.configured && { keySource: indexer }),
        ...(verify && { verify }),
        ...(protocol && { chain: protocol }),
      });
      if (cancelled) return;
      setContent(result);
      // A friend's signed key distribution can arrive after the post itself. Retry without
      // requiring navigation or a reload, and respect the key store's 30-second miss cache.
      if (result.status === "no-key" || result.status === "error") timer = window.setTimeout(() => void open(), 30_000);
    };
    void open();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [post.postId, post.contentHash, post.state, chainId, session, indexer, verify, protocol]);
  return content;
}
