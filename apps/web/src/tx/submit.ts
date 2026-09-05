/**
 * Every on-chain action goes through here: sponsor pool from Settings with self-pay fallback,
 * pending / confirmed / failed toasts (Mana only inside the details expander) and human wording
 * for sponsor refusals.
 */
import { ProtocolClient, SponsorError, type OperationJson, type SignerInterface, type SubmitResult } from "@osp/sdk";
import type { PaymentPreference } from "../stores/settings";
import { useToasts } from "../stores/toasts";
import { errorMessage } from "../util/format";

export interface SubmitContext {
  client: ProtocolClient;
  signer: SignerInterface;
  payment: PaymentPreference;
}

export interface SubmitOptions {
  /** Short human label: "Publishing your post". */
  label: string;
  /** Wording when confirmed. */
  success?: string;
  waitForReceipt?: boolean;
}

export class ActionError extends Error {
  override name = "ActionError";
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export function sponsorWording(error: SponsorError): string {
  switch (error.category) {
    case "quota_exceeded":
      return "The free allowance from the sponsor is used up for now. Try again later, add another sponsor in Settings, or pay from your own account.";
    case "method_not_allowed":
      return "The sponsor does not cover this kind of action. You can pay from your own account or add another sponsor in Settings.";
    case "too_large":
      return "This action is too large for the sponsor to cover. Try a shorter post or pay from your own account.";
    case "chain_mismatch":
      return "The sponsor serves a different network than the one selected in Settings.";
    case "invalid_signature":
    case "invalid_transaction":
      return "The sponsor rejected this request. Check the network in Settings or try another sponsor.";
    case "temporarily_unavailable":
      return "The sponsor is not reachable right now. Try again in a moment or pay from your own account.";
    default:
      return error.message;
  }
}

/** Turns SDK / RPC failures into plain-language messages without jargon. */
export function humanizeError(error: unknown): string {
  if (error instanceof SponsorError) return sponsorWording(error);
  if (error instanceof ActionError) return error.message;
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  if (lower.includes("insufficient rc") || lower.includes("insufficient mana") || lower.includes("rc limit") || lower.includes("payer does not have enough")) {
    return "Your account cannot pay for this action right now and no sponsor accepted it. Add a sponsor in Settings or fund the account.";
  }
  if (lower.includes("duplicate idempotency key")) return "This post was already published; it is being reconciled.";
  if (lower.includes("unregistered")) return "This account is not registered on the network yet.";
  if (lower.includes("authority") || lower.includes("authorization")) return "The network refused this action: this device is not allowed to act for the account.";
  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("econn")) return "The network endpoint is not reachable. Check the RPC list in Settings.";
  return message;
}

export const NO_SPONSOR_MESSAGE = "No sponsor is configured and your settings do not allow paying from your own account. Add a sponsor in Settings or change who pays.";

/** Why the payment preference cannot be honoured right now, if it cannot. */
export function paymentBlocker(payment: PaymentPreference, sponsorCount: number): string | undefined {
  return payment === "sponsor-only" && sponsorCount === 0 ? NO_SPONSOR_MESSAGE : undefined;
}

/** Submits operations with the payment preference; reports progress through toasts. */
export async function submitAction(ctx: SubmitContext, operations: OperationJson[], options: SubmitOptions): Promise<SubmitResult> {
  const toasts = useToasts.getState();
  // "Sponsors only" with an empty pool would silently fall through to self-pay in the SDK.
  const blocker = paymentBlocker(ctx.payment, ctx.client.sponsors.sponsors.length);
  if (blocker) {
    toasts.push({ kind: "error", title: `${options.label}: not sent`, message: blocker, sticky: true });
    throw new ActionError(blocker);
  }
  const id = toasts.push({ kind: "pending", title: options.label, message: "Waiting for the network…", sticky: true });
  try {
    const result = await ctx.client.submit({
      operations,
      signer: ctx.signer,
      ...(ctx.payment === "self-only" && { sponsor: null }),
      selfPayFallback: ctx.payment !== "sponsor-only",
      ...(options.waitForReceipt !== undefined && { waitForReceipt: options.waitForReceipt }),
    });
    const details = [
      `Transaction ${result.transaction.id ?? "(unknown id)"}`,
      result.sponsored ? `Paid by sponsor ${result.sponsor ?? ""}`.trim() : "Paid from your own account",
      `Mana used: ${result.rcUsed}`,
      ...result.refusals.map((r) => `Sponsor ${r.endpoint} declined (${r.error.category})`),
    ];
    const reverted = Boolean(result.receipt.reverted);
    toasts.update(id, {
      kind: reverted ? "error" : "success",
      title: reverted ? `${options.label}: rejected by the network` : (options.success ?? `${options.label}: done`),
      message: reverted ? "The network rejected this action." : undefined,
      details: reverted ? [...details, ...(result.receipt.logs ?? [])] : details,
      sticky: reverted,
    });
    if (reverted) throw new ActionError("The network rejected this action.", result);
    return result;
  } catch (error) {
    if (error instanceof ActionError) throw error;
    if (error instanceof Error && error.name === "TransactionOutcomeUnknownError") {
      const message = "The network did not answer in time. The action may still go through; it will be checked before any retry.";
      toasts.update(id, { kind: "error", title: `${options.label}: outcome unknown`, message, sticky: true, details: [errorMessage(error)] });
      throw new ActionError(message, error);
    }
    if (error instanceof Error && error.name === "TransactionRevertedError") {
      const logs = (error as { logs?: string[] }).logs ?? [];
      const message = humanizeError(new Error(logs.join("; ") || "The network rejected this action."));
      toasts.update(id, { kind: "error", title: `${options.label}: rejected by the network`, message, sticky: true, details: [errorMessage(error), ...logs] });
      throw new ActionError(message, error);
    }
    const message = humanizeError(error);
    toasts.update(id, { kind: "error", title: `${options.label}: failed`, message, sticky: true, details: [errorMessage(error)] });
    throw new ActionError(message, error);
  }
}
