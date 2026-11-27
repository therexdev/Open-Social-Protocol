import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SponsorClient, signPrivateStatement } from "@osp/sdk";
import { useServices } from "../api/services";
import { useMe } from "../features/session";

const mana = (rc: string) => (Number(rc) / 100000000).toLocaleString(undefined, { maximumFractionDigits: 2 });
/** Account data is returned only after a short-lived owner/device proof. */
export function SponsorAllowance() {
  const { protocol, resolved } = useServices(), me = useMe();
  const endpoint = resolved.sponsorUrls[0]?.replace(/\/+$/, "");
  const [state, setState] = useState<{ dailyRc: string; remainingRc?: string; reservedRc?: string; usedRc?: string }>();
  useEffect(() => {
    let alive = true, busy = false;
    setState(undefined);
    const refresh = async () => {
      if (!protocol || !endpoint || busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const doc = await new SponsorClient({ endpoint, expectedChainId: protocol.chainId }).discover();
        const dailyRc = doc.policy.perUser.dailyRc;
        if (!dailyRc || !/^\d{1,16}$/.test(dailyRc)) return;
        if (!me) { if (alive) setState({ dailyRc }); return; }
        const payload = { account: me.account, signer: me.signer.getAddress(), endpoint, expiresAt: Date.now() + 60000 };
        const signature = await signPrivateStatement({ chainId: protocol.chainId, contract: protocol.deployment.contracts.identity.address }, "mana-allowance", payload, me.signer);
        const response = await fetch(`${endpoint}/v1/mana-allowance`, { method: "POST", redirect: "error", credentials: "omit",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, signature }), signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("Allowance unavailable");
        const result = await response.json() as { dailyRc: string; remainingRc: string; reservedRc: string; usedRc: string };
        if (![result.dailyRc, result.remainingRc, result.reservedRc, result.usedRc].every(v => typeof v === "string" && /^\d{1,16}$/.test(v))) throw new Error("Invalid allowance response");
        if (alive) setState(result);
      } catch { if (alive) setState(undefined); }
      finally { busy = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [protocol, endpoint, me?.account, me?.signer]);
  return <Link className="header-osat" to="/settings" aria-label="Sponsored Mana allowance"
    title={state ? `${mana(state.dailyRc)} sponsored Mana per account per UTC day. ${mana(state.usedRc ?? "0")} actually used; ${mana(state.reservedRc ?? "0")} temporarily reserved while transactions become irreversible. ${mana(state.remainingRc ?? state.dailyRc)} available. Reservations are maximums, not charges. Resets at 00:00 UTC.` : "Sponsored Mana allowance unavailable"}>
    <strong>{state?.usedRc !== undefined ? `${mana(state.usedRc)} / ${mana(state.dailyRc)} Mana used` : "Sponsored Mana"}</strong>
    {state && <small>{state.remainingRc === undefined ? `${mana(state.dailyRc)} sponsored / UTC day` : `${mana(state.remainingRc)} available · ${mana(state.reservedRc ?? "0")} pending`}</small>}
  </Link>;
}
