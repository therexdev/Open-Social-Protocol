import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useServices } from "../../api/services";
import { useMe } from "../session";
import { useVaultStore } from "../../vault/context";
import { PrivateStore } from "./privateStore";
import {
  PrivateMessagingService,
  type PrivateSnapshot,
} from "./privateService";

const empty: PrivateSnapshot = {
  enabled: false,
  registered: false,
  chats: [],
  pending: 0,
  error: "",
};
const Context = createContext<{
  service?: PrivateMessagingService;
  snapshot: PrivateSnapshot;
}>({ snapshot: empty });
export function usePrivateMessaging() {
  return useContext(Context);
}
export function PrivateMessagingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const me = useMe(),
    vault = useVaultStore(),
    { protocol, indexer, resolved } = useServices();
  const [value, setValue] = useState<{
    service?: PrivateMessagingService;
    snapshot: PrivateSnapshot;
  }>({ snapshot: empty });
  useEffect(() => {
    setValue({ snapshot: empty });
    if (!me || !protocol) return;
    let alive = true;
    let workPending = false;
    let lastPoll = 0;
    const scope = {
      chainId: protocol.chainId,
      contract: protocol.deployment.contracts.messaging.address,
    };
    const store = new PrivateStore(
      me.account,
      me.seed,
      scope,
      () => alive && vault.getState().session?.identity === me,
    );
    const service = new PrivateMessagingService(
      me,
      protocol,
      indexer,
      store,
      resolved.sponsorUrls,
      resolved.payment,
      (snapshot) => {
        workPending = snapshot.pending > 0 || !!snapshot.preparingAllowance || (snapshot.enabled && !snapshot.registered)
          || snapshot.chats.some(c => c.status === "accepting" || c.status === "outgoing" || c.closing);
        if (alive && vault.getState().session?.identity === me)
          setValue({ service, snapshot });
      },
    );
    void service
      .load()
      .then(() => service.sync())
      .catch((error) => {
        if (alive)
          setValue({
            service,
            snapshot: {
              ...empty,
              error: error instanceof Error ? error.message : String(error),
            },
          });
      });
    const sync = () => {
      lastPoll = Date.now();
      void service.sync();
    };
    // Hidden is not locked. Pausing an open background browser deadlocks the
    // two-party handshake. The service still checks the vault before signing.
    const timer = window.setInterval(() => {
      const readingMessages = document.visibilityState !== "hidden" && window.location.pathname.startsWith("/messages");
      if (Date.now() - lastPoll >= (workPending || readingMessages ? 2000 : 8000)) sync();
    }, 2000);
    window.addEventListener("online", sync);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      alive = false;
      service.stop();
      window.clearInterval(timer);
      window.removeEventListener("online", sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [me, protocol, indexer, resolved, vault]);
  const shown = me && value.service?.me === me ? value : { snapshot: empty };
  return <Context.Provider value={shown}>{children}</Context.Provider>;
}
