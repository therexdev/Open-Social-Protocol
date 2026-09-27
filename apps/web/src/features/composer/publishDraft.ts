/** Publication transport; UI may wait for it or run it in the background. */
import { AUDIENCE, type ProtocolClient } from "@osp/sdk";
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
}

export function planDraft(deps: PublishDeps, request: PublishRequest): Promise<PublishPlan> {
  const audience = request.draft.audience === AUDIENCE.FRIENDS ? AUDIENCE.FRIENDS : AUDIENCE.EVERYONE;
  return buildPublishPlan({
    chain: deps.protocol,
    indexer: deps.indexer,
    me: deps.session.identity,
    keys: deps.session.keys,
    text: request.draft.text,
    audience,
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
  if (draft.audience === AUDIENCE.FRIENDS && p) {
    const ref = { author: draft.account, audienceId: new Uint8Array(0), epoch: p.epoch };
    if (p.epochKey) await deps.session.keys.put(ref, bytesOf(p.epochKey), { recipients: [draft.account, ...p.recipients] });
    else if (p.recipients.length) await deps.session.keys.addRecipients(ref, p.recipients);
  }
  if (deps.background) await saveDraft(deps.session, { ...draft, state: "published", lastError: undefined,
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
  const saved = draft.publication;
  const built = prepared ?? (saved?.operations ? {
    operations: saved.operations, postId: bytesOf(saved.postId), contentHash: bytesOf(saved.contentHash),
    audience: draft.audience, epoch: saved.epoch, recipients: saved.recipients,
    ...(saved.epochKey && { epochKey: bytesOf(saved.epochKey) }),
  } : await planDraft(deps, request));
  const label = request.draft.edit ? "Saving your edit" : request.draft.replyTo ? "Posting your reply" : "Publishing your post";
  const submit = deps.submit ?? submitAction;
  draft = { ...draft, state: "submitting", updatedAt: Date.now(), publication: {
    postId: toBase64url(built.postId), contentHash: toBase64url(built.contentHash), epoch: built.epoch,
    ...(built.epochKey && { epochKey: toBase64url(built.epochKey) }), recipients: built.recipients, operations: built.operations,
  } };
  await saveDraft(session, draft);
  try {
    const result = await submit({ client: protocol, signer: me.signer, payment: deps.payment }, built.operations, {
      label,
      success: request.draft.edit ? "Edit saved" : request.draft.replyTo ? "Reply posted" : "Post published",
      quietProgress: deps.background,
      beforeSubmit: async () => {
        deps.assertActive?.();
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
