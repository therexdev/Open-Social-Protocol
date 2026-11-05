/** Opens a PostView for display through the session key store (decryption on the device). */
import { useEffect, useMemo, useState } from "react";
import { openPost, openPostRevision, type OpenContext, type PostContent } from "../../api/decrypt";
import { chainKeyVerifier } from "../../api/keyProvenance";
import type { PostVersionView, PostView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { useSession } from "../session";

export function usePostContent(post: PostView, revision?: PostVersionView): PostContent | undefined {
  const { resolved, indexer, protocol } = useServices();
  const session = useSession();

  const chainId = resolved.chainId ?? "";
  // Sealed keys from the indexer are trusted only once their distribute_keys transaction is found on chain.
  const verify = useMemo(() => (protocol ? chainKeyVerifier(protocol) : undefined), [protocol]);
  // Scope rendered plaintext to the exact session, network, and version. A lock or
  // route change drops the previous render immediately, before effects run.
  const scope = useMemo(() => ({}), [
    session, protocol, indexer, chainId, post.postId, post.author, post.versionNumber, post.contentHash, post.state,
    post.audience, post.audienceId, post.epoch, post.collectionId, post.envelope,
    revision?.versionNumber, revision?.contentHash, revision?.txId, revision?.blockHeight,
  ]);
  const [opened, setOpened] = useState<{ scope: object; content: PostContent }>();
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const me = session ? { account: session.identity.account, seed: session.identity.seed, encryption: session.identity.encryption } : undefined;
    const open = async () => {
      const context: OpenContext = {
        chainId,
        ...(session && { keys: session.keys }),
        ...(me && { me }),
        ...(indexer.configured && { keySource: indexer }),
        ...(verify && { verify }),
        ...(protocol && { chain: protocol }),
      };
      let result: PostContent;
      try {
        result = revision ? await openPostRevision(post, revision, context, protocol) : await openPost(post, context);
      } catch {
        result = { status: "error", message: "The post could not be opened. Checking again automatically." };
      }
      if (cancelled) return;
      setOpened({ scope, content: result });
      // A friend's signed key distribution can arrive after the post itself. Retry without
      // requiring navigation or a reload, and respect the key store's 30-second miss cache.
      if (post.audience === 2 || result.status === "no-key" || result.status === "error") timer = window.setTimeout(() => void open(), 30_000);
    };
    void open();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scope, verify]);
  return opened?.scope === scope ? opened.content : undefined;
}
