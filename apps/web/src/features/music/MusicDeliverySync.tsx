import { useEffect } from "react";
import { musicConfig, toBase64url } from "@osp/sdk";
import { useServices } from "../../api/services";
import { useVault, useVaultStore } from "../../vault/context";
import { useSubmitContext } from "../session";
import { deliverMusicRequest } from "./musicAccessService";
/** No server has a decryption key. Delivery runs only in the unlocked uploader's client. */
export function MusicDeliverySync() {
  const { protocol } = useServices(),
    session = useVault((s) => s.session),
    vault = useVaultStore(),
    submit = useSubmitContext();
  useEffect(() => {
    if (!protocol || !session || !submit) return;
    let cancelled = false,
      busy = false;
    let cursor: Uint8Array | undefined;
    const retryAfter = new Map<string, number>();
    const active = () => {
      if (cancelled || vault.getState().session !== session)
        throw new Error("Music delivery paused.");
    };
    const sync = async () => {
      if (cancelled || busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        if ((await musicConfig(protocol)).version < 2) return;
        const pending = await protocol.reads.publications.list_music_requests({
          owner: session.identity.account,
          after: cursor,
        });
        for (const request of pending?.items ?? []) {
          active();
          const requestId = `${toBase64url(request.id)}:${request.buyer}`;
          if ((retryAfter.get(requestId) ?? 0) > Date.now()) continue;
          try {
            await deliverMusicRequest(submit, session, request, active);
            retryAfter.delete(requestId);
          } catch {
            retryAfter.set(requestId, Date.now() + 300000);
          }
        }
        cursor = pending?.next.length ? pending.next : undefined;
      } catch {
        /* Track pages expose pending delivery and retry; background errors never reveal keys. */
      } finally {
        busy = false;
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [protocol, session, submit, vault]);
  return null;
}
