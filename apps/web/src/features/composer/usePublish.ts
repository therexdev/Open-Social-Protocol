/**
 * The publish flow shared by the composer, replies and edits: build the plan, persist the
 * attempt, submit in one transaction, remember the epoch key and who holds it, keep a local
 * draft on failure (never republish blindly).
 */
import { useCallback, useMemo } from "react";
import { AUDIENCE, type ProtocolClient } from "@osp/sdk";
import { chainKeyVerifier } from "../../api/keyProvenance";
import type { KeyVerifier } from "../../api/keystore";
import { useServices } from "../../api/services";
import { useSettings, type PaymentPreference } from "../../stores/settings";
import { ActionError, submitAction, type SubmitContext, type SubmitOptions } from "../../tx/submit";
import { toBase64url } from "../../util/bytes";
import type { DraftRecord, Session } from "../../vault/store";
import { useSession } from "../session";
import { removeDraft, saveDraft } from "./drafts";
import { PublishError, buildPublishPlan, findExistingPost, type MediaAttachment, type PublishIndexer, type PublishPlan } from "./publish";

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
    ...(request.media && { media: request.media }),
    ...(request.draft.replyTo && { replyTo: request.draft.replyTo }),
    ...(request.draft.edit && { edit: request.draft.edit }),
    attemptId: request.draft.attemptId,
    createdAt: request.draft.createdAt,
    ...(deps.verify && { verify: deps.verify }),
  });
}

/**
 * Spec 7: every attempt has a persisted local record before anything is signed or broadcast, so
 * a reload mid-submit leaves a "submitting" draft whose retry checks the chain first instead of
 * publishing a second post.
 */
export async function publishDraft(deps: PublishDeps, request: PublishRequest, prepared?: PublishPlan): Promise<PublishOutcome> {
  const { session, protocol } = deps;
  const me = session.identity;
  // A retried attempt must first ask the chain whether the key already produced a post.
  if (request.draft.state !== "draft" && !request.draft.edit) {
    const existing = await findExistingPost(protocol, me.account, request.draft.attemptId);
    if (existing) {
      await removeDraft(session, request.draft.id);
      return { postId: toBase64url(existing), reconciled: true };
    }
  }
  const built = prepared ?? (await planDraft(deps, request));
  const label = request.draft.edit ? "Saving your edit" : request.draft.replyTo ? "Posting your reply" : "Publishing your post";
  const submit = deps.submit ?? submitAction;
  await saveDraft(session, { ...request.draft, state: "submitting", updatedAt: Date.now() });
  try {
    const result = await submit({ client: protocol, signer: me.signer, payment: deps.payment }, built.operations, {
      label,
      success: request.draft.edit ? "Edit saved" : request.draft.replyTo ? "Reply posted" : "Post published",
    });
    if (built.audience === AUDIENCE.FRIENDS) {
      const ref = { author: me.account, audienceId: new Uint8Array(0), epoch: built.epoch };
      if (built.epochKey) await session.keys.put(ref, built.epochKey, { recipients: [me.account, ...built.recipients] });
      else if (built.recipients.length > 0) await session.keys.addRecipients(ref, built.recipients);
    }
    await removeDraft(session, request.draft.id);
    return { postId: toBase64url(built.postId), ...(result.transaction.id && { txId: result.transaction.id }), reconciled: false };
  } catch (error) {
    const cause = error instanceof ActionError ? error.cause : error;
    const unknown = cause instanceof Error && cause.name === "TransactionOutcomeUnknownError";
    await saveDraft(session, {
      ...request.draft,
      updatedAt: Date.now(),
      state: unknown ? "unknown" : "failed",
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function usePublish() {
  const services = useServices();
  const session = useSession();
  const payment = useSettings((s) => s.payment);
  const deps = useMemo<PublishDeps | undefined>(() => {
    if (!session || !services.protocol) return undefined;
    return { session, protocol: services.protocol, indexer: services.indexer, payment, verify: chainKeyVerifier(services.protocol) };
  }, [session, services, payment]);

  const ensure = useCallback((): PublishDeps => {
    if (!session) throw new PublishError("Unlock your account first.");
    if (!deps) throw new PublishError(services.resolved.deploymentMessage ?? "The network is not available.");
    return deps;
  }, [session, deps, services]);

  const plan = useCallback(async (request: PublishRequest): Promise<PublishPlan> => planDraft(ensure(), request), [ensure]);
  const publish = useCallback(async (request: PublishRequest, prepared?: PublishPlan): Promise<PublishOutcome> => publishDraft(ensure(), request, prepared), [ensure]);

  return { plan, publish, ready: deps !== undefined };
}
