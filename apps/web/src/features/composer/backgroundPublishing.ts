import type { ProtocolClient } from "@osp/sdk";
import { toBase64url } from "../../util/bytes";
import type { DraftRecord } from "../../vault/store";
import { listDrafts, saveDraft } from "./drafts";
import { publishDraft, type PublishDeps, type PublishRequest } from "./publishDraft";

export const publicationScope = (protocol: ProtocolClient): string => `${protocol.chainId}:${protocol.deployment.contracts.publications.address}`;
const starting = new Map<string, Promise<DraftRecord>>();
const running = new Map<string, Promise<void>>();
const accounts = new Map<string, Promise<void>>();
const jobKey = (deps: PublishDeps, id: string) => `${publicationScope(deps.protocol)}:${deps.session.identity.account}:${id}`;
export const publicationRunning = (deps: PublishDeps, id: string): boolean => starting.has(jobKey(deps, id)) || running.has(jobKey(deps, id));
/** Resolves after encrypted local persistence. The network job survives route changes. */
export function startPublication(deps: PublishDeps, request: PublishRequest): Promise<DraftRecord> {
  const key = jobKey(deps, request.draft.id);
  const existing = starting.get(key);
  if (existing) return existing;
  const accepted = (async () => {
    deps.assertActive?.();
    if (request.draft.account !== deps.session.identity.account) throw new Error("Unlock the account that wrote this post.");
    const scope = publicationScope(deps.protocol);
    if (request.draft.scope && request.draft.scope !== scope) throw new Error("Switch back to this post's network to resume it.");
    const draft: DraftRecord = { ...request.draft, scope, state: "queued", lastError: undefined, updatedAt: Date.now(),
      ...(request.media && { media: request.media.map(m => ({ ...m, contentHash: toBase64url(m.contentHash) })) }) };
    await saveDraft(deps.session, draft);
    const accountKey = `${scope}:${draft.account}`;
    const work = async () => {
      try {
        deps.assertActive?.();
        const saved = await listDrafts(deps.session);
        const current = saved.find(d => d.id === draft.id);
        if (!current || current.state === "published") return;
        // An earlier uncertain post may still claim the next sequence or create
        // the private reading key. Keep later posts saved until it is resolved.
        if (saved.some(d => d.id !== draft.id && d.scope === scope && (d.state === "unknown" || d.state === "submitting"))) return;
        // Build only when earlier publications have finished: each new post needs
        // the next author sequence and the current trusted friends-audience key.
        await publishDraft({ ...deps, background: true }, { draft: current });
      } catch (error) {
        const current = (await listDrafts(deps.session)).find(d => d.id === draft.id);
        if (current && current.state !== "unknown" && current.state !== "published") {
          await saveDraft(deps.session, { ...current, state: "failed", updatedAt: Date.now(), lastError: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    const task = (accounts.get(accountKey) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (typeof navigator !== "undefined" && navigator.locks) await navigator.locks.request(`osp-publish:${accountKey}`, work);
      else await work();
    });
    accounts.set(accountKey, task);
    running.set(key, task);
    // Every rejection is handled. A failed local write must never resend a job.
    void task.catch(() => undefined).finally(() => {
      starting.delete(key); running.delete(key);
      if (accounts.get(accountKey) === task) accounts.delete(accountKey);
    });
    return draft;
  })();
  starting.set(key, accepted);
  void accepted.catch(() => { starting.delete(key); });
  return accepted;
}
/** Test/diagnostic hook: waiting never submits anything. */
export async function waitForPublication(deps: PublishDeps, id: string): Promise<void> {
  await starting.get(jobKey(deps, id));
  await running.get(jobKey(deps, id));
}
