import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Icon } from "../../../web/src/components/Icon";
import { HeaderOsat } from "../../../web/src/components/HeaderOsat";
import { Toasts } from "../../../web/src/components/Toasts";
import { Notice } from "../../../web/src/components/ui";
import { useServices } from "../../../web/src/api/services";
import { useVault } from "../../../web/src/vault/context";
import { useAccount } from "../../../web/src/stores/account";
import { useProfileName } from "../../../web/src/features/profile/useProfileName";
import { useNotificationsBadge } from "../../../web/src/features/notifications/badge";
import { FriendKeySync } from "../../../web/src/features/friends/FriendKeySync";
import { rpc } from "../shared/rpc";

const primary = [{to:"/",label:"Feed",icon:"home"},{to:"/compose",label:"Post",icon:"plus"},{to:"/groups",label:"Groups",icon:"people"},
  {to:"/messages",label:"Messages",icon:"message"},{to:"/friends",label:"Friends",icon:"people"},{to:"/me",label:"Profile",icon:"profile"}] as const;
const more = [{to:"/people",label:"Find people"},{to:"/notifications",label:"Activity"},{to:"/wallet",label:"Wallet"},{to:"/tokens",label:"OSAT & rewards"},
  {to:"/settings",label:"Account & settings"},{to:"/connections",label:"Browser connections"},{to:"/browser-drafts",label:"Unfinished browser posts"},{to:"/about",label:"About the protocol"}];

export function ExtensionLayout({children}:{children:ReactNode}) {
  const location=useLocation(),vault=useVault(),name=useProfileName(vault.account||"");
  const {resolved}=useServices(),registration=useAccount(s=>s.registration),unread=useNotificationsBadge();
  const [menu,setMenu]=useState(false),[error,setError]=useState("");
  useEffect(()=>{setMenu(false);document.title="Open Social · Browser tools";window.scrollTo({top:0,behavior:"instant"});},[location.pathname]);
  return <div className="extension-client">
    <header className="client-header"><Link to="/" className="client-brand">Open <span>Social</span><small>Browser tools</small></Link>
      <HeaderOsat/><button className="icon-button" aria-label="More menu" aria-expanded={menu} onClick={()=>setMenu(!menu)}><Icon name={menu?"close":"more"}/></button>
    </header>
    <nav className="client-nav" aria-label="Browser tools navigation">{primary.map(item=><NavLink key={item.to} to={item.to==="/me"&&vault.account?`/u/${vault.account}`:item.to} end={item.to==="/"} className={({isActive})=>isActive?"active":""}><Icon name={item.icon} size={18}/><span>{item.label}</span></NavLink>)}</nav>
    {menu&&<section className="client-menu" aria-label="More navigation"><nav>{more.map(item=><Link key={item.to} to={item.to}>{item.label}{item.to==="/notifications"&&unread>0?` (${unread})`:""}</Link>)}</nav>
      <a href={chrome.runtime.getURL("src/permissions/index.html")} target="_blank" rel="noopener noreferrer">Microphone / camera permissions</a>
      {vault.status==="unlocked"?<button className="btn" onClick={()=>{vault.lock();void rpc("vault.lock").catch(e=>setError(e.message));setMenu(false);}}>Lock account and site connections</button>:<Link className="btn btn-primary" to="/welcome">{vault.account?"Unlock account":"Sign in"}</Link>}
    </section>}
    <div className="client-account">{vault.account?<Link to={`/u/${vault.account}`}>{name}</Link>:<Link to="/welcome">Sign in to post and join groups</Link>}<Link to="/notifications" aria-label={unread?`Activity, ${unread} new`:"Activity"}><Icon name="bell" size={17}/>{unread>0&&<span>{unread}</span>}</Link></div>
    <main className="client-main" id="main">
      {!resolved.deployed&&<Notice kind="warning">{resolved.deploymentMessage||"Protocol contracts are not deployed on this network."}</Notice>}
      {vault.status==="unlocked"&&registration==="unregistered"&&<Notice kind="warning">Register your account before posting. <Link to="/welcome">Continue registration</Link></Notice>}
      {error&&<Notice kind="error">{error}</Notice>}
      <FriendKeySync/>{children}
    </main><Toasts/>
  </div>;
}
