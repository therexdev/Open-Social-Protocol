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

/** The host site's name when the attempt has a host side; empty for Koinos-only attempts (side panel, shared page). */
export function hostName(record: Pick<StoredCrossPost, "hostSite" | "adapter">): string {
  if (record.hostSite === "facebook") return "Facebook";
  if (record.hostSite) return record.hostSite;
  return "";
}

export const STALE_SUBMITTING_MS = 2 * 60_000;

/**
 * Records that need a `record_cross_post` proof: an attempt with a real host side (Facebook)
 * whose Koinos post exists and whose host outcome the user has reported (posted or failed).
 * Koinos-only attempts (side panel, "share current page") never record a proof: nothing was
 * cross-posted, and a shared page's link already lives in the envelope's `external_ref`.
 */
export function needsProof(record: StoredCrossPost): boolean {
  if (record.adapter !== "facebook" || record.hostStatus === "not_required") return false;
  if (record.koinosStatus !== "ok" || !record.postId) return false;
  if (record.hostStatus !== "ok" && record.hostStatus !== "failed") return false;
  return record.proof === undefined;
}

/** What the side panel asks for when the user marks the host side as posted. */
export function hostRefPrompt(record: Pick<StoredCrossPost, "hostSite">): string {
  return record.hostSite === "facebook" ? "Link to the Facebook post (open the post and copy its address)" : "Link to the host post";
}

/** hostRef for a `posted` report: an http(s) link on the host site. Returns a reason when it is not. */
export function hostRefProblem(record: Pick<StoredCrossPost, "hostSite">, hostRef: string | undefined): string | undefined {
  if (!hostRef || hostRef.length > 2048) return "Paste the link to the post on the host site to mark it as posted.";
  let url: URL;
  try {
    url = new URL(hostRef);
  } catch {
    return "The host post link is not a valid URL.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "The host post link must be an http(s) URL.";
  if (record.hostSite === "facebook" && !(url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"))) {
    return "The link must point to facebook.com.";
  }
  return undefined;
}

const RETRY_NOTE = "Retry re-uses the same idempotency key, so a duplicate can never be created.";

export function explain(record: StoredCrossPost, now: number = Date.now()): QueueExplanation {
  const host = hostName(record);
  const proofAction: QueueAction[] = needsProof(record) ? ["recordProof"] : [];
  const hostPendingDetail = `${record.hostSubmitted ? `You pressed Post on ${host}. ` : ""}Once the ${host} post is visible, paste its link and mark it posted; if ${host} did not publish it, mark it failed. The proof is recorded on chain only once both sides are known.`;
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
      if (record.koinosStatus === "ok" && record.hostStatus === "pending") {
        return {
          title: `Published on Open Social, ${host || "host"} side pending`,
          detail: `The Koinos post exists and will never be published twice. ${hostPendingDetail}`,
          actions: ["markHostPosted", "markHostFailed"],
          attention: true,
        };
      }
      if (record.koinosStatus === "failed" && record.hostStatus === "pending") {
        return {
          title: "Not published on Open Social",
          detail: `${record.lastError ?? "The publication failed."} ${RETRY_NOTE} The ${host || "host"} side is still yours to report.`,
          actions: ["retry", "markHostPosted", "markHostFailed", "discard"],
          attention: true,
        };
      }
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
          ? `Published on Open Social and recorded with a signed proof (${host}).`
          : proofAction.length > 0
            ? `Published on Open Social. The signed proof manifest for ${host} has not been recorded on chain yet${record.proofError ? `: ${record.proofError}` : "."}`
            : "Published on Open Social.",
        actions: proofAction,
        attention: false,
      };
    case "partial": {
      if (record.koinosStatus === "ok") {
        // Host failed (a pending host is "submitting"): the Koinos post stays; the proof records the partial outcome.
        return {
          title: `Published on Open Social, ${host} side failed`,
          detail: `The Koinos post exists (it will never be published twice). ${host} did not publish the post${record.lastError ? `: ${record.lastError}` : "."}${
            record.proof ? " The partial outcome was recorded with a signed proof." : proofAction.length > 0 ? ` The signed proof of the partial outcome has not been recorded yet${record.proofError ? `: ${record.proofError}` : "."}` : ""
          }`,
          actions: proofAction,
          attention: proofAction.length > 0,
        };
      }
      if (record.hostStatus === "not_required") {
        // A Koinos-only attempt (side panel / shared page) whose publication failed.
        return {
          title: "Not published on Open Social",
          detail: `${record.lastError ?? "The publication failed."} ${RETRY_NOTE}`,
          actions: ["retry", "discard"],
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
        detail: `${record.lastError ?? "The transaction was rejected."} ${RETRY_NOTE}`,
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
