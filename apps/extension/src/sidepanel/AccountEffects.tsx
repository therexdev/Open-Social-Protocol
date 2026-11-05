import { useEffect, useRef } from "react";
import { useServices } from "../../../web/src/api/services";
import { useAccount } from "../../../web/src/stores/account";
import { useSettings } from "../../../web/src/stores/settings";
import { useVault } from "../../../web/src/vault/context";

/** Extension account lifecycle, independent of the website entry point and layout. */
export function AccountEffects() {
  const status = useVault(s => s.status), account = useVault(s => s.account);
  const setAutoLockMs = useVault(s => s.setAutoLockMs), minutes = useSettings(s => s.autoLockMinutes);
  const services = useServices(), previous = useRef(services);
  useEffect(() => { setAutoLockMs(minutes * 60_000); }, [minutes, setAutoLockMs]);
  useEffect(() => {
    const force = previous.current !== services; previous.current = services;
    if (status === "empty") useAccount.getState().reset();
    if (status !== "unlocked" || !account) return;
    void useAccount.getState().check(services, account, force);
    const refresh = () => { if (document.visibilityState !== "hidden") void useAccount.getState().check(services, account); };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); };
  }, [status, account, services]);
  return null;
}
