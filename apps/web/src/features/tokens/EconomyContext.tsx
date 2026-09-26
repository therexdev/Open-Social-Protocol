import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { EconomyConfig, ProtocolClient } from "@osp/sdk";
import { humanizeError } from "../../tx/submit";
interface State { policy?: EconomyConfig; version?: number; block?: string; epoch?: string; error?: string; }
const Context = createContext<State>({});
/** One policy refresh for the whole app, not one RPC request per feed card. */
export function EconomyProvider({ protocol, children }: { protocol?: ProtocolClient; children: ReactNode }) {
  const [state, setState] = useState<State>({});
  useEffect(() => {
    let alive = true, busy = false;
    setState({});
    const load = async () => {
      if (!protocol || busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const config = await protocol.reads.token.get_config({});
        if (!alive) return;
        const version = config?.value?.economy_version ?? 0;
        if (!version) { setState({ version }); return; }
        const result = await protocol.reads.token.get_economy({});
        if (alive) setState({ version, policy: result?.value, block: result?.block, epoch: result?.current_epoch });
      } catch (error) { if (alive) setState(old => ({ ...old, error: humanizeError(error) })); }
      finally { busy = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [protocol]);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
export const useEconomy = () => useContext(Context);
