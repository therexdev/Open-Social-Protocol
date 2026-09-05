/** App shell: header, navigation (bottom bar on small screens), deployment banner, toasts. */
import { type ReactNode } from "react";
import { NavLink, Link } from "react-router-dom";
import { APP_NAME, DOCS } from "../config";
import { useServices } from "../api/services";
import { useAccount } from "../stores/account";
import { useVault } from "../vault/context";
import { useNotificationsBadge } from "../features/notifications/badge";
import { Toasts } from "./Toasts";

function DeploymentBanner() {
  const { resolved } = useServices();
  if (resolved.deployed) return null;
  return (
    <div className="banner banner-warning" role="status">
      <strong>Protocol contracts are not deployed on {resolved.network} yet</strong> - see {DOCS.deployTestnet}. You can create and export your account and
      change Settings; posting, friends and other network actions are disabled until a deployment manifest exists.
    </div>
  );
}

function IndexerBanner() {
  const { resolved } = useServices();
  if (resolved.indexerUrl) return null;
  return (
    <div className="banner banner-info" role="status">
      No indexer is configured, so feeds and profiles cannot be loaded. Add one in <Link to="/settings">Settings</Link> (or run your own: apps/indexer).
    </div>
  );
}

/** Primary-journey step 2 is easy to skip; keep pointing at it until the account is on chain. */
function RegistrationBanner() {
  const status = useVault((s) => s.status);
  const registration = useAccount((s) => s.registration);
  const { resolved } = useServices();
  if (status !== "unlocked" || !resolved.deployed || registration !== "unregistered") return null;
  return (
    <div className="banner banner-warning" role="status">
      <strong>Your account is not registered on the network yet.</strong> Friends cannot share private posts with you and you cannot post until it is.{" "}
      <Link to="/welcome">Register now</Link>.
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const status = useVault((s) => s.status);
  const lock = useVault((s) => s.lock);
  const unread = useNotificationsBadge();
  const signedIn = status === "unlocked";
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label={`${APP_NAME} home`}>
          <span className="brand-mark" aria-hidden="true" />
          {APP_NAME}
        </Link>
        <nav className="nav" aria-label="Primary">
          <NavLink to="/" end>
            Feed
          </NavLink>
          <NavLink to="/compose">Post</NavLink>
          <NavLink to="/friends">Friends</NavLink>
          <NavLink to="/notifications">
            Activity
            {unread > 0 && (
              <span className="badge" aria-label={`${unread} new`}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="topbar-actions">
          {signedIn ? (
            <button type="button" className="btn btn-ghost" onClick={lock}>
              Lock
            </button>
          ) : status === "locked" ? (
            <span className="muted">Locked</span>
          ) : null}
        </div>
      </header>
      <DeploymentBanner />
      <IndexerBanner />
      <RegistrationBanner />
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
      <Toasts />
    </div>
  );
}
