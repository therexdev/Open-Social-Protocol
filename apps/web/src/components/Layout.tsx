/** App shell: header, navigation (bottom bar on small screens), deployment banner, toasts. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import { APP_NAME, DOCS } from "../config";
import { useServices } from "../api/services";
import { useAccount } from "../stores/account";
import { useVault } from "../vault/context";
import { useNotificationsBadge } from "../features/notifications/badge";
import { FriendKeySync } from "../features/friends/FriendKeySync";
import { Avatar, Icon, type IconName } from "./Icon";
import { SocialRail } from "./SocialRail";
import { Button } from "./ui";
import { useSwipeTabs } from "./useSwipeTabs";
import { InstallButton, PwaStatus } from "../pwa/PwaControls";
import { useProfileName } from "../features/profile/useProfileName";
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

const primary = [
  { to: "/", label: "Feed", icon: "home" },
  { to: "/people", label: "Explore", icon: "compass" },
  { to: "/friends", label: "Friends", icon: "people" },
  { to: "/messages", label: "Messages", icon: "message" },
  { to: "/me", label: "Profile", icon: "profile" },
] as const;
const secondary = [
  { to: "/notifications", label: "Activity", icon: "bell" },
  { to: "/tokens", label: "Tokens", icon: "token" },
  { to: "/settings", label: "Settings", icon: "settings" },
  { to: "/about", label: "About Open Social", icon: "info" },
] as const;

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const status = useVault((s) => s.status);
  const account = useVault((s) => s.account);
  const lock = useVault((s) => s.lock);
  const unread = useNotificationsBadge();
  const [menuOpen, setMenuOpen] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia?.("(min-width: 1251px)").matches ?? false);
  useEffect(() => { const query = window.matchMedia?.("(min-width: 1251px)"); if (!query) return; const changed = () => setWide(query.matches); query.addEventListener("change", changed); return () => query.removeEventListener("change", changed); }, []);
  const menu = useRef<HTMLDialogElement>(null);
  const name = useProfileName(account ?? "");
  const ownProfile = account ? `/u/${account}` : "/me";
  const mobilePages = ["/", "/people", "/friends", "/messages", ownProfile];
  const swipe = useSwipeTabs(direction => {
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    const index = mobilePages.indexOf(location.pathname);
    const next = mobilePages[index + direction];
    if (index >= 0 && next) navigate(next);
  });
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    const dialog = menu.current;
    if (!dialog) return;
    if (menuOpen && !dialog.open) dialog.showModal?.();
    if (!menuOpen && dialog.open) dialog.close?.();
  }, [menuOpen]);
  useEffect(() => {
    const path = location.pathname;
    const title = [...primary, ...secondary].find(item => item.to === path)?.label ?? (path.startsWith("/u/") ? "Profile" : path === "/compose" ? "New post" : "Open Social");
    document.title = title === "Open Social" ? title : `${title} · Open Social`;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  const navItem = (item: { to: string; label: string; icon: IconName }, mobile = false) => {
    const profile = item.to === "/me";
    return <NavLink key={item.to} to={profile ? ownProfile : item.to} end={item.to === "/"} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}><span className="nav-icon"><Icon name={item.icon} size={22} />{item.to === "/notifications" && unread > 0 && <span className="badge" aria-label={`${unread} new`}>{unread > 99 ? "99+" : unread}</span>}</span><span>{mobile && profile ? "Profile" : item.label}</span></NavLink>;
  };
  const lockControl = status === "unlocked" ? <Button variant="ghost" onClick={lock}><Icon name="lock"/> Lock account</Button> : status === "locked" ? <Link className="btn btn-ghost" to="/welcome" state={{ from: `${location.pathname}${location.search}${location.hash}` }}><Icon name="lock"/> Unlock account</Link> : <Link className="btn btn-primary" to="/welcome">Get started <Icon name="arrow" /></Link>;
  const fullWidth = ["/messages", "/settings", "/welcome", "/compose"].includes(location.pathname);
  return <div className={`app${fullWidth ? " app-wide" : ""}${location.pathname === "/compose" ? " app-composing" : ""}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="sidebar">
      <Link to="/" className="brand" aria-label={`${APP_NAME} home`}><span>Open<span className="brand-light"> Social</span></span></Link>
      <nav className="desktop-nav" aria-label="Primary">{primary.map(item => navItem(item))}</nav>
      <section className="sidebar-topics"><h2>Topics</h2><form onSubmit={event => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get("tag") ?? "").trim().replace(/^#/, ""); if (value) navigate(`/tags/${encodeURIComponent(value)}`); }}><Icon name="search" size={16}/><input name="tag" aria-label="Search hashtags" placeholder="Search topics" maxLength={64}/></form>{["community", "technology", "art", "photography"].map(tag => <Link key={tag} to={`/tags/${tag}`}># <span>{tag}</span></Link>)}</section>
      <div className="sidebar-bottom">{navItem(secondary[2])}<button className="nav-item" onClick={() => setMenuOpen(true)}><Icon name="more" size={22}/>More</button><Link className="btn btn-primary create-post" to="/compose"><Icon name="plus" size={19}/>Create a post</Link>{account && <Link className="sidebar-profile" to={ownProfile}><Avatar account={account} name={name}/><span><strong>{name}</strong><small>Your account</small></span></Link>}</div>
    </aside>
    <div className="app-workspace">
      <header className="topbar">
        <Link to="/" className="brand mobile-brand" aria-label="Open Social home"><span>Open<span className="brand-light"> Social</span></span></Link>
        <form className="header-search" role="search" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); navigate(`/people?q=${encodeURIComponent(String(data.get("q") ?? ""))}`); }}><Icon name="search"/><input name="q" aria-label="Find people by nickname" placeholder="Find your people…" maxLength={64}/><button type="submit" aria-label="Search people"><Icon name="arrow" size={18}/></button></form>
        <div className="topbar-actions">{status === "locked" && <Link className="btn btn-ghost header-unlock" to="/welcome" state={{ from: `${location.pathname}${location.search}${location.hash}` }}>Unlock</Link>}<Link className="icon-button mobile-search" to="/people" aria-label="Find people"><Icon name="search"/></Link><Link className="icon-button notification-link" to="/notifications" aria-label={unread ? `Activity, ${unread} new` : "Activity"}><Icon name="bell"/>{unread > 0 && <span className="notification-dot"/>}</Link>{account && <Link className="header-avatar" to={ownProfile} aria-label="Your profile"><Avatar account={account} name={name}/></Link>}</div>
      </header>
      <div className="app-banners"><DeploymentBanner/><IndexerBanner/><RegistrationBanner/><PwaStatus/></div>
      <div className="content-grid">
        <main id="main" className="main" tabIndex={-1} {...swipe}>
          <FriendKeySync/>
          <div key={location.pathname} className="route-content">{children}</div>
        </main>
        {wide && !fullWidth && <SocialRail/>}
      </div>
    </div>
    <button type="button" className="icon-button mobile-more" aria-label="More menu" onClick={() => setMenuOpen(true)} aria-haspopup="dialog" aria-expanded={menuOpen}><Icon name="more"/></button>
    <nav className="mobile-nav" aria-label="Mobile navigation">{primary.map(item => navItem(item, true))}</nav>
    <dialog ref={menu} className="dialog more-menu" aria-labelledby="more-menu-title" onCancel={() => setMenuOpen(false)} onClose={() => setMenuOpen(false)}><div className="page-header"><h2 id="more-menu-title">More to explore</h2><Button variant="ghost" aria-label="Close menu" onClick={() => setMenuOpen(false)}><Icon name="close"/></Button></div><nav aria-label="More navigation">{navItem(primary[1])}{secondary.map(item => navItem(item))}</nav><div className="menu-footer"><InstallButton/>{lockControl}</div></dialog>
    <Toasts/>
  </div>;
}
