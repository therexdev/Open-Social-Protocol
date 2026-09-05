/**
 * The publish flow shared by the composer, replies and edits: build the plan, submit in one
 * transaction, remember the epoch key, keep a local draft on failure (never republish blindly).
 */
import { useCallback } from "react";
import { AUDIENCE } from "@osp/sdk";
import { useServices } from "../../api/services";
import { useSettings } from "../../stores/settings";
import { ActionError, submitAction } from "../../tx/submit";
import { toBase64url } from "../../util/bytes";
import type { DraftRecord } from "../../vault/store";
import { useSession } from "../session";
import { removeDraft, saveDraft } from "./drafts";
import { PublishError, buildPublishPlan, findExistingPost, type MediaAttachment, type PublishPlan } from "./publish";

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

export function usePublish() {
  const services = useServices();
  const session = useSession();
  const payment = useSettings((s) => s.payment);

  const plan = useCallback(
    async (request: PublishRequest): Promise<PublishPlan> => {
      if (!session) throw new PublishError("Unlock your account first.");
      if (!services.protocol) throw new PublishError(services.resolved.deploymentMessage ?? "The network is not available.");
      const audience = request.draft.audience === AUDIENCE.FRIENDS ? AUDIENCE.FRIENDS : AUDIENCE.EVERYONE;
      return buildPublishPlan({
        chain: services.protocol,
        indexer: services.indexer,
        me: session.identity,
        keys: session.keys,
        text: request.draft.text,
        audience,
        ...(request.media && { media: request.media }),
        ...(request.draft.replyTo && { replyTo: request.draft.replyTo }),
        ...(request.draft.edit && { edit: request.draft.edit }),
        attemptId: request.draft.attemptId,
        createdAt: request.draft.createdAt,
      });
    },
    [services, session],
  );

  const publish = useCallback(
    async (request: PublishRequest, prepared?: PublishPlan): Promise<PublishOutcome> => {
      if (!session) throw new PublishError("Unlock your account first.");
      if (!services.protocol) throw new PublishError(services.resolved.deploymentMessage ?? "The network is not available.");
      const me = session.identity;
      // Spec 7: a retried attempt must first ask the chain whether the key already produced a post.
      if (request.draft.state !== "draft" && !request.draft.edit) {
        const existing = await findExistingPost(services.protocol, me.account, request.draft.attemptId);
        if (existing) {
          await removeDraft(session, request.draft.id);
          return { postId: toBase64url(existing), reconciled: true };
        }
      }
      const built = prepared ?? (await plan(request));
      const label = request.draft.edit ? "Saving your edit" : request.draft.replyTo ? "Posting your reply" : "Publishing your post";
      try {
        const result = await submitAction({ client: services.protocol, signer: me.signer, payment }, built.operations, {
          label,
          success: request.draft.edit ? "Edit saved" : request.draft.replyTo ? "Reply posted" : "Post published",
        });
        if (built.epochKey) await session.keys.put({ author: me.account, audienceId: new Uint8Array(0), epoch: built.epoch }, built.epochKey);
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
    },
    [services, session, payment, plan],
  );

  return { plan, publish, ready: Boolean(session && services.protocol) };
}
