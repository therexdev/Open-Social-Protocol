/** Hooks that expose the unlocked session and whether on-chain actions are possible. */
import { useMemo } from "react";
import type { Identity } from "@osp/sdk";
import { useServices } from "../api/services";
import { useSettings } from "../stores/settings";
import type { SubmitContext } from "../tx/submit";
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

/** Unlocked account + deployed contracts = network actions allowed. */
export function useCanAct(): ActAbility {
  const status = useVault((s) => s.status);
  const { resolved } = useServices();
  if (!resolved.deployed) return { ok: false, reason: `Protocol contracts are not deployed on ${resolved.network} yet.` };
  if (status !== "unlocked") return { ok: false, reason: "Unlock your account first." };
  return { ok: true };
}

export function useSubmitContext(): SubmitContext | undefined {
  const me = useMe();
  const { protocol } = useServices();
  const payment = useSettings((s) => s.payment);
  return useMemo(() => (me && protocol ? { client: protocol, signer: me.signer, payment } : undefined), [me, protocol, payment]);
}
