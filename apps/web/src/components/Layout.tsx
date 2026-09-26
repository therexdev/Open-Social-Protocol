/** App shell: header, navigation (bottom bar on small screens), deployment banner, toasts. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import { APP_NAME, DOCS } from "../config";
import { useServices } from "../api/services";
import { useAccount } from "../stores/account";
import { useVault } from "../vault/context";
import { useNotificationsBadge } from "../features/notifications/badge";
import { FriendKeySync } from "../features/friends/FriendKeySync";
import { Avatar, BrandMark, Icon, type IconName } from "./Icon";
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
  { to: "/people", label: "Find people", icon: "search" },
  { to: "/friends", label: "Friends", icon: "people" },
  { to: "/messages", label: "Messages", icon: "message" },
  { to: "/me", label: "Your profile", icon: "profile" },
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
  const menu = useRef<HTMLDialogElement>(null);
  const name = useProfileName(account ?? "");
  const ownProfile = account ? `/u/${account}` : "/me";
  const mobilePages = ["/", "/friends", "/messages", ownProfile];
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
  return <div className="app">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="sidebar">
      <Link to="/" className="brand" aria-label={`${APP_NAME} home`}><BrandMark/><span>Open<span className="brand-light"> Social</span></span></Link>
      <span className="sidebar-caption">A LITTLE MORE HUMAN.</span>
      <nav className="desktop-nav" aria-label="Primary">{primary.map(item => navItem(item))}<div className="nav-divider"/>{secondary.map(item => navItem(item))}</nav>
      <div className="sidebar-bottom"><InstallButton/>{account && <Link className="sidebar-profile" to={ownProfile}><Avatar account={account} name={name}/><span><strong>{name}</strong><small>Your account</small></span><Icon name="arrow" size={17}/></Link>}{lockControl}</div>
    </aside>
    <div className="app-workspace">
      <header className="topbar">
        <Link to="/" className="brand mobile-brand" aria-label="Open Social home"><BrandMark/><span>Open Social</span></Link>
        <form className="header-search" role="search" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); navigate(`/people?q=${encodeURIComponent(String(data.get("q") ?? ""))}`); }}><Icon name="search"/><input name="q" aria-label="Find people by nickname" placeholder="Find your people…" maxLength={64}/><button type="submit" aria-label="Search people"><Icon name="arrow" size={18}/></button></form>
        <div className="topbar-actions">{status === "locked" && <Link className="btn btn-ghost header-unlock" to="/welcome" state={{ from: `${location.pathname}${location.search}${location.hash}` }}>Unlock</Link>}<Link className="icon-button mobile-search" to="/people" aria-label="Find people"><Icon name="search"/></Link><Link className="icon-button notification-link" to="/notifications" aria-label={unread ? `Activity, ${unread} new` : "Activity"}><Icon name="bell"/>{unread > 0 && <span className="notification-dot"/>}</Link>{account && <Link className="header-avatar" to={ownProfile} aria-label="Your profile"><Avatar account={account} name={name}/></Link>}</div>
      </header>
      <div className="app-banners"><DeploymentBanner/><IndexerBanner/><RegistrationBanner/><PwaStatus/></div>
      <div className="content-grid">
        <main id="main" className="main" tabIndex={-1} {...swipe}>
          <FriendKeySync/>
          <div key={location.pathname} className="route-content">{children}</div>
        </main>
        <aside className="right-rail" aria-label="Discover Open Social">
          <div className="rail-intro"><span className="eyebrow">SOCIAL, ON YOUR TERMS</span><h2>Your people.<br/>Your posts.<br/><span>Yours.</span></h2><p>A place to connect, without starting over when you change apps.</p><Link to="/about">Meet Open Social <Icon name="arrow" size={17}/></Link></div>
          <div className="rail-card"><span className="feature-icon"><Icon name="people"/></span><h3>Good conversations start with people.</h3><p>Find friends by nickname and make this space your own.</p><Link className="btn" to="/people">Find people <Icon name="arrow" size={17}/></Link></div>
          <div className="rail-footer"><Link to="/about">About the protocol</Link><Link to="/settings">Settings</Link><span>Built to be open.</span></div>
        </aside>
      </div>
    </div>
    <nav className="mobile-nav" aria-label="Mobile navigation">{primary.filter(item => item.to !== "/people").map(item => navItem(item, true))}<button type="button" className={`nav-item${menuOpen ? " active" : ""}`} onClick={() => setMenuOpen(true)} aria-haspopup="dialog" aria-expanded={menuOpen}><Icon name="more" size={22}/><span>More</span></button></nav>
    <dialog ref={menu} className="dialog more-menu" aria-labelledby="more-menu-title" onCancel={() => setMenuOpen(false)} onClose={() => setMenuOpen(false)}><div className="page-header"><h2 id="more-menu-title">More to explore</h2><Button variant="ghost" aria-label="Close menu" onClick={() => setMenuOpen(false)}><Icon name="close"/></Button></div><nav aria-label="More navigation">{navItem(primary[1])}{secondary.map(item => navItem(item))}</nav><div className="menu-footer"><InstallButton/>{lockControl}</div></dialog>
    <Toasts/>
  </div>;
}
