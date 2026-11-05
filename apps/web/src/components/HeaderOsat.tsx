import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { walletBalance } from "@osp/sdk";
import { useServices } from "../api/services";
import { useMe } from "../features/session";

const balanceFormat = new Intl.NumberFormat();

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

  const amount = balance === undefined ? undefined : balanceFormat.format(BigInt(balance));
  const balanceLabel = amount !== undefined ? `${amount} OSAT` : me ? "OSAT balance unavailable" : "OSAT";
  const testnet = resolved.network === "harbinger";
  const description = testnet ? `${balanceLabel}. Testnet price $0.10 USD per OSAT` : balanceLabel;
  return (
    <Link className="header-osat" to="/tokens" title={description} aria-label={`${description}. View token details`}>
      <strong>{me && <span>{amount ?? "—"}</span>} OSAT</strong>
      {testnet && <small>Testnet $0.10<span className="osat-price-unit">/ea</span></small>}
    </Link>
  );
}
