import { useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, Icon } from "./Icon";

export function QuickComposer({ account, name }: { account?: string; name?: string }) {
  const [audience, setAudience] = useState("public");
  const to = `/compose?audience=${audience}`;
  return <div className="quick-composer">
    <Avatar account={account ?? ""} name={name}/>
    <Link className="compose-prompt" to={to}>What’s happening?</Link>
    <select aria-label="New post audience" value={audience} onChange={event => setAudience(event.target.value)}><option value="public">Public</option><option value="friends">Friends</option></select>
    <Link className="btn btn-primary" to={to}><Icon name="plus" size={18}/><span>Post</span></Link>
  </div>;
}
