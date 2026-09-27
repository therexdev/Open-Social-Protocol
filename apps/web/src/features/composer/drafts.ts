/** Local drafts (encrypted at rest) keyed by attempt id so retries reuse the idempotency key. */
import { newAttemptId } from "@osp/sdk";
import type { DraftRecord, DraftsFile, Session } from "../../vault/store";
import { toHex } from "../../util/bytes";

const changes = new Set<(account: string) => void>();
export function subscribeDrafts(listener: (account: string) => void): () => void {
  changes.add(listener);
  return () => { changes.delete(listener); };
}
const writes = new Map<string, Promise<unknown>>();
/** Serialize encrypted read/modify/write across concurrent posts and browser tabs. */
async function changeDrafts(session: Session, update: (drafts: DraftRecord[]) => DraftRecord[]): Promise<void> {
  const account = session.identity.account;
  const mutate = async () => {
    await session.drafts.save({ drafts: update(await listDrafts(session)) } satisfies DraftsFile);
    for (const listener of changes) listener(account);
  };
  const pending = (writes.get(account) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    if (typeof navigator !== "undefined" && navigator.locks) await navigator.locks.request(`osp-drafts:${account}`, mutate);
    else await mutate();
  });
  writes.set(account, pending);
  try { await pending; } finally { if (writes.get(account) === pending) writes.delete(account); }
}

export async function listDrafts(session: Session): Promise<DraftRecord[]> {
  const file = await session.drafts.load();
  return file?.drafts ?? [];
}

export async function saveDraft(session: Session, draft: DraftRecord): Promise<void> {
  await changeDrafts(session, drafts => [...drafts.filter(d => d.id !== draft.id), draft]);
}

export async function removeDraft(session: Session, id: string): Promise<void> {
  await changeDrafts(session, drafts => drafts.filter(d => d.id !== id));
}

export function newDraft(account: string, fields: Pick<DraftRecord, "text" | "audience" | "mediaUrls" | "replyTo" | "edit">): DraftRecord {
  const attemptId = toHex(newAttemptId());
  const now = Date.now();
  return { id: attemptId, attemptId, account, createdAt: now, updatedAt: now, state: "draft", ...fields };
}
