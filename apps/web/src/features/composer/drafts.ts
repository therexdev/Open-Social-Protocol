/** Local drafts (encrypted at rest) keyed by attempt id so retries reuse the idempotency key. */
import { newAttemptId } from "@osp/sdk";
import type { DraftRecord, DraftsFile, Session } from "../../vault/store";
import { toHex } from "../../util/bytes";

export async function listDrafts(session: Session): Promise<DraftRecord[]> {
  const file = await session.drafts.load();
  return file?.drafts ?? [];
}

export async function saveDraft(session: Session, draft: DraftRecord): Promise<void> {
  const drafts = (await listDrafts(session)).filter((d) => d.id !== draft.id);
  drafts.push(draft);
  await session.drafts.save({ drafts } satisfies DraftsFile);
}

export async function removeDraft(session: Session, id: string): Promise<void> {
  const drafts = (await listDrafts(session)).filter((d) => d.id !== id);
  await session.drafts.save({ drafts });
}

export function newDraft(account: string, fields: Pick<DraftRecord, "text" | "audience" | "mediaUrls" | "replyTo" | "edit">): DraftRecord {
  const attemptId = toHex(newAttemptId());
  const now = Date.now();
  return { id: attemptId, attemptId, account, createdAt: now, updatedAt: now, state: "draft", ...fields };
}
