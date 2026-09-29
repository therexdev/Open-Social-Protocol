import { useState } from "react";
import { Link } from "react-router-dom";
import { PeopleSearch } from "../people/PeopleSearch";
import { Avatar, Icon } from "../../components/Icon";
import { AccountLink, Button, Card, Empty, Notice, Spinner, Tabs } from "../../components/ui";
import { timeAgo } from "../../util/format";
import { useVault } from "../../vault/context";
import { useProfileName } from "../profile/useProfileName";
import { RelationshipActions } from "./RelationshipActions";
import { useMessagePeople } from "../messages/useMessagePeople";
import { ignoreRequest, ignoredRequests, unignoreRequest } from "./actions";

function Person({ account, children }: { account: string; children?: React.ReactNode }) {
  const name = useProfileName(account);
  return (
    <li className="list-item">
      <span className="person-identity"><Avatar account={account} name={name} /><span><AccountLink account={account} name={name} /><small className="muted person-address">{account.slice(0, 7)}…{account.slice(-5)}</small></span></span>
      {children}
    </li>
  );
}

export function FriendsPage() {
  const me = useVault((s) => s.account);
  const { graph, error, loading, refresh, name } = useMessagePeople(me, []);
  const [tab, setTab] = useState<"friends" | "requests" | "sent">("friends");
  const [search, setSearch] = useState("");
  const [finding, setFinding] = useState(false);
  const [ignored, setIgnored] = useState<string[]>(() => (me ? ignoredRequests(me) : []));

  const incoming = (graph?.pendingIncoming ?? []).filter((r) => !ignored.includes(r.account));
  const hidden = (graph?.pendingIncoming ?? []).filter((r) => ignored.includes(r.account));

  return (
    <div className="page friends-page">
      <div className="page-header"><div><h1>Friends</h1><p className="page-subtitle">Your people, all in one place.</p></div><Button variant="primary" onClick={() => setFinding(value => !value)} aria-expanded={finding}><Icon name="plus" size={18}/>Find people</Button></div>
      {finding && <Card title="Find people"><PeopleSearch /></Card>}
      <Tabs value={tab} onChange={setTab} label="Friends views" options={[{ value: "friends", label: `Your friends (${graph?.friends.length ?? 0})` }, { value: "requests", label: `Requests (${incoming.length})` }, { value: "sent", label: `Sent (${graph?.pendingOutgoing.length ?? 0})` }]}/>
      {error && <Notice kind="error">{error}</Notice>}
      {loading && !graph && <Spinner />}
      <section hidden={tab !== "requests"} role="tabpanel" aria-label="Requests"><Card title={`Friend requests (${incoming.length})`}>
        {incoming.length === 0 ? (
          <Empty>No pending requests.</Empty>
        ) : (
          <ul className="list">
            {incoming.map((r) => (
              <Person key={r.account} account={r.account}>
                <span className="muted">{timeAgo(r.requestedAt)}</span>
                <div className="row">
                  <RelationshipActions target={r.account} graph={graph} onChanged={() => void refresh()} compact />
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (me) ignoreRequest(me, r.account);
                      setIgnored(me ? ignoredRequests(me) : []);
                    }}
                  >
                    Ignore
                  </Button>
                </div>
              </Person>
            ))}
          </ul>
        )}
        {hidden.length > 0 && (
          <p className="muted">
            {hidden.length} ignored request(s).{" "}
            <Button
              variant="ghost"
              onClick={() => {
                if (me) for (const r of hidden) unignoreRequest(me, r.account);
                setIgnored(me ? ignoredRequests(me) : []);
              }}
            >
              Show them
            </Button>
          </p>
        )}
      </Card></section>
      <section hidden={tab !== "sent"} role="tabpanel" aria-label="Sent"><Card title={`Sent requests (${graph?.pendingOutgoing.length ?? 0})`}>
        {(graph?.pendingOutgoing.length ?? 0) === 0 ? (
          <Empty>No outgoing requests.</Empty>
        ) : (
          <ul className="list">
            {graph?.pendingOutgoing.map((r) => (
              <Person key={r.account} account={r.account}>
                <span className="muted">sent {timeAgo(r.requestedAt)}</span>
              </Person>
            ))}
          </ul>
        )}
      </Card></section>
      <section hidden={tab !== "friends"} role="tabpanel" aria-label="Your friends"><Card title={`Your friends (${graph?.friends.length ?? 0})`}>
        <div className="friend-search"><Icon name="search" size={18}/><input type="search" aria-label="Search your friends" placeholder="Search your friends…" value={search} onChange={event => setSearch(event.target.value)}/></div>
        {(graph?.friends.length ?? 0) === 0 ? (
          <Empty>No friends yet. Search for someone above and send a request.</Empty>
        ) : (
          <ul className="list">
            {graph?.friends.filter(f => `${name(f.account)} ${f.account}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map((f) => (
              <Person key={f.account} account={f.account}>
                <div className="row friend-actions"><Link className="btn" to={`/u/${f.account}`}>View profile</Link><Link className="btn btn-primary" to={`/messages?to=${f.account}`}><Icon name="message" size={17}/>Message</Link><details className="friend-options"><summary aria-label={`Manage friendship with ${name(f.account)}`}><Icon name="more"/></summary><RelationshipActions target={f.account} graph={graph} onChanged={() => void refresh()} /></details></div>
              </Person>
            ))}
          </ul>
        )}
        {!!graph?.friends.length && !graph.friends.some(f => `${name(f.account)} ${f.account}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) && <Empty>No friends match your search.</Empty>}
      </Card></section>
      <div className="friend-privacy"><Icon name="lock"/><div><strong>A little more private.</strong><p>Friends can read each other's past and future friends-only posts. Access is shared automatically while each author's account is unlocked.</p><Button variant="ghost" onClick={() => { window.dispatchEvent(new CustomEvent("osp:sync-friend-keys", { detail: { repair: true } })); void refresh(); }}>Sync private-post access</Button></div></div>
      <details className="connections-details"><summary>Following, followers & blocked accounts</summary><div className="stack">
      <Card title={`Following (${graph?.following.length ?? 0})`}>
        {(graph?.following.length ?? 0) === 0 ? (
          <Empty>You are not following anyone.</Empty>
        ) : (
          <ul className="list">
            {graph?.following.map((a) => (
              <Person key={a} account={a}>
                <RelationshipActions target={a} graph={graph} onChanged={() => void refresh()} compact />
              </Person>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Followers (${graph?.followers.length ?? 0})`}>
        {(graph?.followers.length ?? 0) === 0 ? (
          <Empty>No followers yet.</Empty>
        ) : (
          <ul className="list">
            {graph?.followers.map((a) => (
              <Person key={a} account={a} />
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Blocked (${graph?.blocked.length ?? 0})`}>
        {(graph?.blocked.length ?? 0) === 0 ? (
          <Empty>Nobody is blocked.</Empty>
        ) : (
          <ul className="list">
            {graph?.blocked.map((a) => (
              <Person key={a} account={a}>
                <RelationshipActions target={a} graph={graph} onChanged={() => void refresh()} compact />
              </Person>
            ))}
          </ul>
        )}
      </Card>
      </div></details>
    </div>
  );
}
