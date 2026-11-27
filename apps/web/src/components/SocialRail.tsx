import { Link } from "react-router-dom";
import { useVault } from "../vault/context";
import { usePrivateMessaging } from "../features/messages/PrivateMessagingProvider";
import { useMessagePeople } from "../features/messages/useMessagePeople";
import { BrowserPluginPromo } from "./BrowserPluginPromo";
import { Avatar, Icon } from "./Icon";

/** Only mounted when the desktop rail is visible. Uses real connections and local chats. */
export function SocialRail({ promotePlugin = false }: { promotePlugin?: boolean }) {
  const account = useVault(s => s.status === "unlocked" ? s.account : undefined);
  const { snapshot } = usePrivateMessaging();
  const chats = snapshot.chats.filter(c => c.status !== "closed").slice(0, 3);
  const people = useMessagePeople(account, chats.map(c => c.peer));
  return <aside className="right-rail" aria-label="Your connections">
    {promotePlugin && <BrowserPluginPromo/>}
    <section className="rail-card"><div className="rail-heading"><h2>Your people</h2><Link to="/friends" aria-label="View all friends"><Icon name="arrow" size={18}/></Link></div>
      {people.friends.slice(0, 5).map(peer => <div className="rail-person" key={peer}><Avatar account={peer} name={people.name(peer)}/><Link to={`/u/${peer}`}><strong>{people.name(peer)}</strong><small>Friend</small></Link><Icon name="people" size={16}/></div>)}
      {people.friends.length === 0 && <p className="rail-empty">{people.loading ? "Finding your people…" : "A good conversation starts with a connection."}</p>}
      {people.error && !people.graph && <p className="hint">Your friends list is temporarily unavailable.</p>}
      <Link className="btn btn-ghost rail-link" to="/people"><Icon name="plus" size={16}/> Find people</Link>
    </section>
    <section className="rail-card"><div className="rail-heading"><h2>Messages</h2><Icon name="message" size={18}/></div>
      {chats.map(chat => <div className="rail-person" key={chat.id}><Avatar account={chat.peer} name={people.name(chat.peer)}/><Link to={`/messages?to=${chat.peer}`}><strong>{people.name(chat.peer)}</strong><small>{chat.messages.at(-1)?.text || "Start a conversation"}</small></Link></div>)}
      {!chats.length && <p>Keep the conversation going in private.</p>}
      <Link className="rail-link" to="/messages">Open messages <Icon name="arrow" size={16}/></Link>
    </section>
    <div className="rail-note"><Icon name="lock" size={18}/><p>Your connections belong to you.<br/>Your friends-only posts are encrypted.</p></div>
    <div className="rail-footer"><Link to="/browser-plugin">Browser Plugin</Link><Link to="/about">About Open Social</Link><Link to="/settings">Settings</Link><span>Built on an open protocol.</span></div>
  </aside>;
}
