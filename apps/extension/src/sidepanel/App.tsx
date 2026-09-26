import { EconomyPanel } from "./Economy";
import { useEffect } from "react";
import { shortAddress } from "../shared/format";
import { rpc } from "../shared/rpc";
import { Composer } from "./Composer";
import { DeviceAuth } from "./DeviceAuth";
import { Feed } from "./Feed";
import { Onboarding, Unlock } from "./Onboarding";
import { UnfinishedPosts } from "./UnfinishedPosts";
import { usePanel } from "./store";

function openOptions() {
  void chrome.runtime.openOptionsPage();
}

export function App() {
  const { status, loading, error, tab, setTab, refreshStatus, loadQueue, run, clearError, skippedDeviceStep } = usePanel();

  useEffect(() => {
    void refreshStatus();
    void loadQueue();
    const timer = setInterval(() => {
      void refreshStatus();
    }, 30_000);
    const changed = (changes: Record<string, unknown>, area: string) => { if (area === "local" && "osp.crossposts" in changes) void loadQueue(); };
    chrome.storage.onChanged.addListener(changed);
    return () => { clearInterval(timer); chrome.storage.onChanged.removeListener(changed); };
  }, [refreshStatus, loadQueue]);

  if (loading || !status) return <div className="content">Loading…</div>;

  const header = (
    <div className="topbar">
      <span className="brand">Open Social</span>
      {status.account && <span className="acct" title={status.account}>{shortAddress(status.account)}</span>}
      {status.status === "unlocked" && (
        <button
          onClick={() =>
            run(async () => {
              await rpc("vault.lock");
              await refreshStatus();
            })
          }
        >
          Lock
        </button>
      )}
      <button onClick={openOptions} title="Settings">
        ⚙
      </button>
    </div>
  );

  const requestedPost = new URLSearchParams(location.hash.slice(1)).get("post");
  let body;
  if (status.status === "empty") body = <Onboarding />;
  else if (status.status === "locked") body = <Unlock />;
  else if (!status.deviceAuthorized && !skippedDeviceStep) body = <DeviceAuth />;
  else if (requestedPost && /^[A-Za-z0-9_-]{43}=?$/.test(requestedPost)) body = <EconomyPanel postId={requestedPost} initialDirection={Number(new URLSearchParams(location.hash.slice(1)).get("direction")) === 2 ? 2 : 1}/>;
  else {
    body = (
      <>
        <div className="tabs">
          <button className={tab === "feed" ? "active" : ""} onClick={() => setTab("feed")}>
            Feed
          </button>
          <button className={tab === "compose" ? "active" : ""} onClick={() => setTab("compose")}>
            Compose
          </button>
        </div>
        <div className="content">
          {!status.network.deployed && <div className="notice">Read-only: {status.network.message}</div>}
          {!status.deviceAuthorized && (
            <div className="notice">
              This browser is not authorized to publish yet. <button className="link" onClick={() => usePanel.setState({ skippedDeviceStep: false })}>Authorize</button>
            </div>
          )}
          {tab === "feed" && <Feed />}
          {tab === "compose" && <><Composer /><UnfinishedPosts /></>}
        </div>
      </>
    );
  }

  return (
    <div className="app">
      {header}
      {error && (
        <div className="content" style={{ paddingBottom: 0 }}>
          <div className="error">
            {error} <button className="link" onClick={clearError}>dismiss</button>
          </div>
        </div>
      )}
      {body}
    </div>
  );
}
