/** Hooks that expose the unlocked session and whether on-chain actions are possible. */
import { useMemo } from "react";
import type { Identity } from "@osp/sdk";
import { useServices } from "../api/services";
import { useAccount } from "../stores/account";
import { useSettings } from "../stores/settings";
import { paymentBlocker, type SubmitContext } from "../tx/submit";
import { useVault } from "../vault/context";
import type { Session } from "../vault/store";

export function useSession(): Session | undefined {
  return useVault((s) => s.session);
}

export function useMe(): Identity | undefined {
  return useVault((s) => s.session?.identity);
}

export interface ActAbility {
  ok: boolean;
  /** Plain-language reason when actions are disabled. */
  reason?: string;
}

export const REGISTER_FIRST = "Register your account on the network first.";

/** Unlocked, registered account + deployed contracts + a payer = network actions allowed. */
export function useCanAct(): ActAbility {
  const status = useVault((s) => s.status);
  const registration = useAccount((s) => s.registration);
  const { resolved } = useServices();
  if (!resolved.deployed) return { ok: false, reason: `Protocol contracts are not deployed on ${resolved.network} yet.` };
  if (status !== "unlocked") return { ok: false, reason: "Unlock your account first." };
  if (registration === "unregistered") return { ok: false, reason: REGISTER_FIRST };
  const blocker = paymentBlocker(resolved.payment, resolved.sponsorUrls.length);
  if (blocker) return { ok: false, reason: blocker };
  return { ok: true };
}

export function useSubmitContext(): SubmitContext | undefined {
  const me = useMe();
  const { protocol } = useServices();
  const payment = useSettings((s) => s.payment);
  return useMemo(() => (me && protocol ? { client: protocol, signer: me.signer, payment } : undefined), [me, protocol, payment]);
}
