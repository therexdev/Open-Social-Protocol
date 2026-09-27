import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useServices } from "../../api/services";
import { chainKeyVerifier } from "../../api/keyProvenance";
import { useVaultStore, useVault } from "../../vault/context";
import type { DraftRecord } from "../../vault/store";
import { listDrafts, saveDraft, subscribeDrafts } from "./drafts";
import { publicationRunning, publicationScope, startPublication } from "./backgroundPublishing";
import { reconcileDraft, type PublishDeps, type PublishRequest } from "./publishDraft";

interface Publishing {
  ready: boolean;
  posts: DraftRecord[];
  start(request: PublishRequest): Promise<DraftRecord>;
  check(): Promise<void>;
}
const Context = createContext<Publishing | undefined>(undefined);
export function PublishingProvider({ children }: { children: ReactNode }) {
  const services = useServices(), vault = useVaultStore(), session = useVault(s => s.session);
  const current = useRef(services); current.current = services;
  const deps = useMemo<PublishDeps | undefined>(() => {
    if (!session || !services.protocol) return;
    return { session, protocol: services.protocol, indexer: services.indexer, payment: services.resolved.payment,
      background: true, verify: chainKeyVerifier(services.protocol), assertActive: () => {
        if (vault.getState().session !== session || current.current !== services) throw new Error("Unlock your account on this network to finish posting.");
      } };
  }, [session, services, vault]);
  const [snapshot, setSnapshot] = useState<{ deps: PublishDeps; posts: DraftRecord[] }>();
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const version = ++generation.current;
    if (!deps) { setSnapshot(undefined); return; }
    const scope = publicationScope(deps.protocol);
    const posts = (await listDrafts(deps.session)).filter(d => d.scope === scope && d.account === deps.session.identity.account && d.state !== "draft");
    if (generation.current === version) setSnapshot({ deps, posts: posts.sort((a, b) => b.createdAt - a.createdAt) });
  }, [deps]);
  const checking = useRef(false);
  const check = useCallback(async () => {
    if (!deps || checking.current) return;
    checking.current = true;
    try {
      const scope = publicationScope(deps.protocol);
      for (const draft of await listDrafts(deps.session)) {
        deps.assertActive?.();
        if (draft.scope !== scope || publicationRunning(deps, draft.id)) continue;
        if (draft.state === "queued") { await startPublication(deps, { draft }); continue; }
        if (draft.state !== "submitting" && draft.state !== "unknown") continue;
        if (!(await reconcileDraft(deps, draft)) && draft.state === "submitting") {
          await saveDraft(deps.session, { ...draft, state: "unknown", lastError: "Confirmation is taking longer. Checking automatically; your post is saved." });
        }
      }
    } catch { /* Offline or locked: preserve the encrypted draft and check again later. */ }
    finally { checking.current = false; await reload(); }
  }, [deps, reload]);
  useEffect(() => {
    void reload().catch(() => undefined);
    const unsubscribe = subscribeDrafts(account => { if (account === session?.identity.account) void reload().catch(() => undefined); });
    const poll = () => { if (document.visibilityState !== "hidden") void check().catch(() => undefined); };
    poll();
    const timer = window.setInterval(poll, 8000);
    window.addEventListener("online", poll); window.addEventListener("focus", poll);
    return () => { generation.current++; unsubscribe(); clearInterval(timer); window.removeEventListener("online", poll); window.removeEventListener("focus", poll); };
  }, [session, reload, check]);
  const start = useCallback(async (request: PublishRequest) => {
    if (!deps) throw new Error("Unlock your account first.");
    const draft = await startPublication(deps, request);
    await reload();
    return draft;
  }, [deps, reload]);
  return <Context.Provider value={{ ready: !!deps, posts: snapshot && snapshot.deps === deps ? snapshot.posts : [], start, check }}>{children}</Context.Provider>;
}
export function usePublishing(): Publishing {
  const value = useContext(Context);
  if (!value) throw new Error("PublishingProvider is missing");
  return value;
}
