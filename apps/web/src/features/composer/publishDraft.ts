import { archiveClip } from "../media/clipArchive";
import { archivePhoto } from "./archivePhoto";
/** Publication transport; UI may wait for it or run it in the background. */
import { AUDIENCE, LIFECYCLE, MUSIC_CHUNK_BYTES, requirePhotoLibrary, type ProtocolClient } from "@osp/sdk";
import type { KeyVerifier } from "../../api/keystore";
import type { PaymentPreference } from "../../stores/settings";
import { ActionError, submitAction, type SubmitContext, type SubmitOptions } from "../../tx/submit";
import { bytesOf, toBase64url } from "../../util/bytes";
import type { DraftRecord, Session } from "../../vault/store";
import { removeDraft, saveDraft } from "./drafts";
import { PublishError, buildPublishPlan, currentEpoch, findExistingPost, type MediaAttachment, type PublishIndexer, type PublishPlan } from "./publish";
export interface PublishOutcome {
  /** base64url post id. */
  postId: string;
  txId?: string;
  /** True when the idempotency key already had a post (no new transaction). */
  reconciled: boolean;
}

export interface PublishRequest {
  draft: DraftRecord;
  media?: MediaAttachment[];
}

export interface PublishDeps {
  session: Session;
  protocol: ProtocolClient;
  indexer: PublishIndexer;
  payment: PaymentPreference;
  verify?: KeyVerifier;
  /** Injectable for tests; defaults to submitAction. */
  submit?: (ctx: SubmitContext, operations: PublishPlan["operations"], options: SubmitOptions) => ReturnType<typeof submitAction>;
  background?: boolean;
  assertActive?: () => void;
  onProgress?: (draftId: string, progress: PublishProgress | undefined) => void;
}
export interface PublishProgress {
  stage: "preparing" | "uploading" | "publishing";
  uploadedBytes: number;
  totalBytes: number;
}

export async function planDraft(deps: PublishDeps, request: PublishRequest): Promise<PublishPlan> {
  if (request.draft.audience === AUDIENCE.CUSTOM || request.draft.galleryOnly || request.draft.collectionId) await requirePhotoLibrary(deps.protocol);
  const audience = request.draft.audience === AUDIENCE.CUSTOM ? AUDIENCE.CUSTOM : request.draft.audience === AUDIENCE.FRIENDS ? AUDIENCE.FRIENDS : AUDIENCE.EVERYONE;
  return buildPublishPlan({
    chain: deps.protocol,
    indexer: deps.indexer,
    me: deps.session.identity,
    keys: deps.session.keys,
    text: request.draft.text,
    ...(request.draft.poll && { poll: request.draft.poll }),
    audience,
    selectedAccounts: request.draft.selectedAccounts,
    replyGuard: request.draft.replyGuard,
    collectionId: request.draft.collectionId,
    galleryOnly: request.draft.galleryOnly,
    ...((request.media ?? request.draft.media) && { media: request.media ?? request.draft.media!.map(m => ({ ...m, contentHash: bytesOf(m.contentHash) })) }),
    ...(request.draft.replyTo && { replyTo: request.draft.replyTo }),
    ...(request.draft.edit && { edit: request.draft.edit }),
    attemptId: request.draft.attemptId,
    createdAt: request.draft.createdAt,
    ...(deps.verify && { verify: deps.verify }),
  });
}

async function completeDraft(deps: PublishDeps, draft: DraftRecord, outcome: PublishOutcome): Promise<PublishOutcome> {
  const p = draft.publication;
  if (draft.audience !== AUDIENCE.EVERYONE && p) {
    const ref = { author: draft.account, audienceId: p.audienceId ? bytesOf(p.audienceId) : new Uint8Array(0), epoch: p.epoch };
    if (p.epochKey) await deps.session.keys.put(ref, bytesOf(p.epochKey), { recipients: [draft.account, ...p.recipients] });
    else if (p.recipients.length) await deps.session.keys.addRecipients(ref, p.recipients);
  }
  if (deps.background) await saveDraft(deps.session, { ...draft, media: draft.media?.map(({ archiveBytes, videoPoster, ...reference }) => reference), state: "published", lastError: undefined,
    publication: { postId: outcome.postId, contentHash: p?.contentHash ?? "", epoch: p?.epoch ?? 0, recipients: [], txId: outcome.txId ?? p?.txId }, updatedAt: Date.now() });
  else await removeDraft(deps.session, draft.id);
  return outcome;
}

/** Read-only recovery, including edits: an uncertain outcome never resends itself. */
export async function reconcileDraft(deps: PublishDeps, draft: DraftRecord): Promise<PublishOutcome | undefined> {
  const existing = await findExistingPost(deps.protocol, draft.account, draft.attemptId);
  if (!existing) return undefined;
  return completeDraft(deps, draft, { postId: toBase64url(existing), reconciled: true });
}

/**
 * Spec 7: every attempt has a persisted local record before anything is signed or broadcast, so
 * a reload mid-submit leaves a "submitting" draft whose retry checks the chain first instead of
 * publishing a second post.
 */
export async function publishDraft(deps: PublishDeps, request: PublishRequest, prepared?: PublishPlan): Promise<PublishOutcome> {
  const { session, protocol } = deps;
  const me = session.identity;
  deps.assertActive?.();
  let draft = request.draft;
  // A retried attempt must first ask the chain whether the key already produced a post.
  if (draft.state !== "draft") {
    const existing = await reconcileDraft(deps, draft);
    if (existing) return existing;
  }
  // An uncertain attempt must keep its exact encrypted payload and reading key.
  // Rebuilding it could replace the key while the original transaction confirms.
  const checkThread = async () => {
    let parentId = draft.replyTo;
    if (draft.edit) {
      const record = (await protocol.reads.publications.get_post({ post_id: bytesOf(draft.edit.postId) }))?.value;
      if (!record || record.author !== draft.account || toBase64url(record.latest_version) !== draft.edit.previousVersion || record.version_count + 1 !== draft.edit.versionNumber)
        throw new PublishError("This post changed after the editor opened. Your draft is saved. Open the latest version before editing again.");
      parentId = record.reply_to?.length ? toBase64url(record.reply_to) : undefined;
    }
    if (!parentId) return;
    const parent = (await protocol.reads.publications.get_post({ post_id: bytesOf(parentId) }))?.value;
    if (!parent || parent.state !== LIFECYCLE.ACTIVE) throw new PublishError("This thread is no longer available.");
    if (parent.audience === AUDIENCE.EVERYONE) return;
    const guard = draft.replyGuard;
    const ownFriends = draft.edit && draft.audience === AUDIENCE.FRIENDS && parent.audience === AUDIENCE.FRIENDS && parent.author === draft.account;
    if (draft.replyTo !== parentId || !guard || (draft.audience !== AUDIENCE.CUSTOM && !ownFriends) || toBase64url(parent.latest_version) !== guard.parentHash ||
        (parent.audience === AUDIENCE.FRIENDS && (await currentEpoch(protocol, parent.author)) !== guard.friendsEpoch))
      throw new PublishError("The readers of this thread changed. Reopen the original post to compose a new private reply.");
  };
  await checkThread();
  const saved = draft.publication;
  const built = prepared ?? (saved?.operations ? {
    operations: saved.operations, postId: bytesOf(saved.postId), contentHash: bytesOf(saved.contentHash),
    audience: draft.audience, epoch: saved.epoch, ...(saved.audienceId && { audienceId: bytesOf(saved.audienceId) }), recipients: saved.recipients,
    ...(saved.epochKey && { epochKey: bytesOf(saved.epochKey) }),
  } : await planDraft(deps, request));
  const label = request.draft.edit ? "Saving your edit" : request.draft.replyTo ? "Posting your reply" : "Publishing your post";
  const submit = deps.submit ?? submitAction;
  draft = { ...draft, state: "submitting", updatedAt: Date.now(), publication: {
    ...(built.audienceId && { audienceId: toBase64url(built.audienceId) }),
    postId: toBase64url(built.postId), contentHash: toBase64url(built.contentHash), epoch: built.epoch,
    ...(built.epochKey && { epochKey: toBase64url(built.epochKey) }), recipients: built.recipients, operations: built.operations,
  } };
  await saveDraft(session, draft);
  try {
  const uploads = (request.media ?? draft.media?.map(m => ({ ...m, contentHash: bytesOf(m.contentHash) })) ?? [])
    .flatMap(m => [...(m.videoPoster ? [{ ...m.videoPoster, contentHash: bytesOf(m.videoPoster.contentHash) }] : []), m]).filter(m => m.archiveBytes);
  const totalBytes = uploads.reduce((n, m) => n + m.size, 0);
  let uploadedBytes = 0;
  for (const media of uploads) {
    const ctx = { client: protocol, signer: me.signer, payment: deps.payment };
    const report = (bytes: number) => deps.onProgress?.(draft.id, { stage: "uploading", uploadedBytes: uploadedBytes + bytes, totalBytes });
    report(0);
    if (media.url.startsWith("osp-clip://")) await archiveClip(media, ctx, me.account, deps.assertActive, (received, total) => report(received >= total ? media.size : Math.min(media.size, received * MUSIC_CHUNK_BYTES)));
    else await archivePhoto(media, ctx, me.account, deps.assertActive, report);
    uploadedBytes += media.size;
  }
    deps.onProgress?.(draft.id, { stage: "publishing", uploadedBytes: totalBytes, totalBytes });
    const result = await submit({ client: protocol, signer: me.signer, payment: deps.payment }, built.operations, {
      label,
      success: request.draft.edit ? "Edit saved" : request.draft.replyTo ? "Reply posted" : "Post published",
      quietProgress: deps.background,
      beforeSubmit: async () => {
        deps.assertActive?.();
        await checkThread();
        if (built.audience === AUDIENCE.FRIENDS && await currentEpoch(protocol, me.account) !== built.epoch) {
          throw new PublishError("Your private-post audience changed after this preview. Review the post again so removed friends do not receive it.");
        }
      },
    });
    return await completeDraft(deps, draft, { postId: toBase64url(built.postId), ...(result.transaction.id && { txId: result.transaction.id }), reconciled: false });
  } catch (error) {
    // A retry may race with the first transaction's confirmation. Reconcile its
    // original payload before reporting a duplicate-key rejection as a failure.
    try { const existing = await reconcileDraft(deps, draft); if (existing) return existing; } catch { /* Keep the saved attempt for recovery. */ }
    const cause = error instanceof ActionError ? error.cause : error;
    const unknown = cause instanceof Error && cause.name === "TransactionOutcomeUnknownError";
    await saveDraft(session, {
      ...draft,
      updatedAt: Date.now(),
      state: unknown ? "unknown" : "failed",
      ...(!unknown && { publication: { ...draft.publication!, operations: undefined } }),
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
