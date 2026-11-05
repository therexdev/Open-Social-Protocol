import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { walletBalance } from "@osp/sdk";
import { useServices } from "../api/services";
import { useMe } from "../features/session";

const balanceFormat = new Intl.NumberFormat();
const usdDollars = new Intl.NumberFormat("en-US");
const harbingerCentsPerOsat = 17n;

export function HeaderOsat() {
  const { protocol, resolved } = useServices();
  const me = useMe();
  const [lastRead, setLastRead] = useState<{ protocol: typeof protocol; account: string; amount: string }>();
  const balance = me && lastRead?.protocol === protocol && lastRead?.account === me.account ? lastRead.amount : undefined;

  useEffect(() => {
    if (!protocol || !me) return;
    let active = true;
    let reading = false;
    const refresh = async () => {
      if (reading || document.visibilityState === "hidden") return;
      reading = true;
      try {
        const result = await walletBalance(protocol, "osat", me.account, me.signer.getAddress());
        if (active) setLastRead({ protocol, account: me.account, amount: result.balance });
      } catch {
        if (active) setLastRead(undefined);
      } finally {
        reading = false;
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [protocol, me]);

  const tokens = balance === undefined ? undefined : BigInt(balance);
  const amount = tokens === undefined ? undefined : balanceFormat.format(tokens);
  const balanceLabel = amount !== undefined ? `${amount} OSAT` : me ? "OSAT balance unavailable" : "OSAT";
  const cents = resolved.network === "harbinger" && tokens !== undefined ? tokens * harbingerCentsPerOsat : undefined;
  const total = cents === undefined ? undefined : `Total: $${usdDollars.format(cents / 100n)}.${(cents % 100n).toString().padStart(2, "0")}`;
  const description = total ? `${balanceLabel}. ${total}` : balanceLabel;
  return (
    <Link className="header-osat" to="/tokens" title={description} aria-label={`${description}. View token details`}>
      <strong>{me && <span>{amount ?? "—"}</span>} OSAT</strong>
      {total && <small>{total}</small>}
    </Link>
  );
}
