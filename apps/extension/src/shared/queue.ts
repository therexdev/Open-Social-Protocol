/**
 * Human explanations and deterministic actions for cross-post records (spec section 7). Shared
 * by the side panel (display) and the service worker (which actions are legal).
 */
import type { QueueAction, StoredCrossPost } from "./protocol";

export interface QueueExplanation {
  title: string;
  detail: string;
  actions: QueueAction[];
  /** Attention needed from the user. */
  attention: boolean;
}

export function hostName(record: Pick<StoredCrossPost, "hostSite" | "adapter">): string {
  if (record.hostSite === "facebook") return "Facebook";
  if (record.hostSite) return record.hostSite;
  return record.adapter === "generic" ? "the shared page" : "";
}

export const STALE_SUBMITTING_MS = 2 * 60_000;

/** Records that need proof recording: both sides known, Koinos succeeded, an adapter with a host/external side. */
export function needsProof(record: StoredCrossPost): boolean {
  if (record.adapter === "sidepanel") return false;
  if (record.koinosStatus !== "ok" || !record.postId || !record.koinosTxId) return false;
  if (record.hostStatus === "pending" || record.hostStatus === "unknown") return false;
  return record.proof === undefined;
}

export function explain(record: StoredCrossPost, now: number = Date.now()): QueueExplanation {
  const host = hostName(record);
  const proofAction: QueueAction[] = needsProof(record) ? ["recordProof"] : [];
  switch (record.state) {
    case "draft":
      return {
        title: "Waiting for your confirmation",
        detail: host
          ? `Nothing has been published to Open Social yet. Review the audience and confirm, or discard.`
          : "Review the audience and confirm to publish, or discard.",
        actions: ["confirm", "discard"],
        attention: true,
      };
    case "submitting": {
      const stale = now - record.updatedAt > STALE_SUBMITTING_MS;
      return {
        title: stale ? "Publication interrupted" : "Publishing on Koinos",
        detail: stale
          ? "The submission did not finish (the browser may have suspended the extension). Reconcile looks the post up on chain before anything is sent again."
          : "Your post is being signed and submitted. Nothing is re-sent automatically.",
        actions: stale ? ["reconcile"] : [],
        attention: stale,
      };
    }
    case "succeeded":
      return {
        title: "Published",
        detail: record.proof
          ? `Published on Open Social${host ? ` and recorded with a signed proof (${host})` : ""}.`
          : proofAction.length > 0
            ? `Published on Open Social. The signed proof manifest for ${host} has not been recorded on chain yet${record.proofError ? `: ${record.proofError}` : "."}`
            : "Published on Open Social.",
        actions: proofAction,
        attention: false,
      };
    case "partial": {
      if (record.koinosStatus === "ok") {
        return {
          title: `Published on Open Social, ${host} side not confirmed`,
          detail: `The Koinos post exists (it will never be published twice). ${host === "Facebook" ? "If the Facebook post went through, mark it as posted; otherwise mark it failed." : `Mark the ${host} side as posted or failed.`}${record.lastError ? ` Last error: ${record.lastError}` : ""}`,
          actions: record.hostStatus === "ok" ? [...proofAction] : ["markHostPosted", "markHostFailed", ...proofAction],
          attention: true,
        };
      }
      return {
        title: `Posted on ${host || "the host"}, not on Open Social`,
        detail: `The host publication is kept (${record.hostRef ?? "reference recorded"}). Retry publishes only the Koinos side with the same idempotency key.${record.lastError ? ` Last error: ${record.lastError}` : ""}`,
        actions: ["retry", "discard"],
        attention: true,
      };
    }
    case "unknown":
      return {
        title: "Koinos outcome unknown",
        detail: "The node did not answer in time, so the post may or may not exist. Reconcile checks the chain (and the indexer) first; nothing is re-sent until the lookup says it is safe.",
        actions: ["reconcile"],
        attention: true,
      };
    case "failed":
      return {
        title: "Publication failed",
        detail: `${record.lastError ?? "The transaction was rejected."} Retry re-uses the same idempotency key, so a duplicate can never be created.`,
        actions: ["retry", "discard"],
        attention: true,
      };
    case "reconcile_required":
      return {
        title: "Manual review needed",
        detail: `Conflicting facts were recorded (${record.lastError ?? "unknown conflict"}). Automatic retries are disabled for this attempt: check the post on chain, then discard the record.`,
        actions: ["discard"],
        attention: true,
      };
    default:
      return { title: record.state, detail: "", actions: [], attention: false };
  }
}

export function needsAttention(record: StoredCrossPost, now: number = Date.now()): boolean {
  return explain(record, now).attention;
}

export function hostPendingDefault(record: StoredCrossPost): boolean {
  return record.hostStatus === "pending" && record.adapter === "facebook";
}
