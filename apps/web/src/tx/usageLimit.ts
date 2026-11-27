import { InsufficientManaError, SponsorError } from "@osp/sdk";
import { useUsagePrompt, type UsageLimitKind } from "../stores/usagePrompt";
import type { SubmitContext } from "./submit";

const burst = (error: SponsorError) => error.category === "quota_exceeded" && /burst|per \d+\s*s|too (?:many|quick)/i.test(error.message);
const daily = (error: SponsorError) => error.category === "quota_exceeded" && !burst(error) && /daily|allowance|free usage/i.test(error.message);
const capacity = (error: SponsorError) => error.category === "temporarily_unavailable" && /(?:pool|sponsor).*(?:busy or depleted|depleted|not enough|insufficient)/i.test(error.message);
export const insufficientCapacity = (message: string) => /insufficient (?:rc|mana)|payer does not have enough(?: rc| mana| resource)|account.*(?:not enough|no).*mana/i.test(message);

/** Only positive capacity refusals belong here. A transport/unknown outcome must
 * retain reconciliation, and a burst limit must never suggest buying capacity. */
export function usageLimitKind(error: unknown): UsageLimitKind | undefined {
  if (!(error instanceof Error) || error.name === "TransactionOutcomeUnknownError") return;
  if (error instanceof InsufficientManaError) {
    if (error.refusals.some(r => daily(r.error))) return "daily";
    if (error.refusals.some(r => capacity(r.error))) return "service";
    if (error.refusals.some(r => burst(r.error) || r.error.category === "invalid_transaction" || r.error.category === "invalid_signature")) return;
    return "account";
  }
  if (error instanceof SponsorError) {
    if (daily(error)) return "daily";
    if (capacity(error)) return "service";
    return;
  }
  const logs = (error as { logs?: string[] }).logs;
  if (insufficientCapacity(logs?.join("; ") || error.message)) return "account";
}
export function usageLimitMessage(kind: UsageLimitKind): string {
  if (kind === "daily") return "Your free daily usage is used up or temporarily held by recent activity. Try again shortly, wait for the daily reset, or use a funded account for extra usage.";
  if (kind === "service") return "Free usage is temporarily unavailable. Try again later, or use a funded account for extra usage.";
  return "Your account does not have enough recharged capacity for this action. Wait for it to recharge, or add KOIN to your current wallet.";
}
export function presentUsageLimit(error: unknown, ctx: SubmitContext, background = false, canUseOwnAccount = true): void {
  const kind = usageLimitKind(error);
  if (!kind) return;
  const payer = ctx.contentSigner?.signer.getAddress() ?? ctx.signer.getAddress();
  const now = new Date();
  useUsagePrompt.getState().open({ kind, chainId: ctx.client.chainId, payer,
    canUseOwnAccount: canUseOwnAccount && payer === ctx.signer.getAddress(),
    ...(kind === "daily" && { resetAt: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) }),
  }, background);
}
