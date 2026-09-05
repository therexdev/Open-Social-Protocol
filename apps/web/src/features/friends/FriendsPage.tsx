import { useState } from "react";
import { isAddress } from "@osp/sdk";
import type { ProfileSummary } from "../../api/indexer";
import { useServices } from "../../api/services";
import { AccountLink, Button, Card, Empty, Field, Notice, Spinner } from "../../components/ui";
import { errorMessage, timeAgo } from "../../util/format";
import { useVault } from "../../vault/context";
import { useProfileName } from "../profile/useProfileName";
import { RelationshipActions, useGraph } from "./RelationshipActions";
import { ignoreRequest, ignoredRequests, unignoreRequest } from "./actions";

function Person({ account, children }: { account: string; children?: React.ReactNode }) {
  const name = useProfileName(account);
  return (
    <li className="list-item">
      <AccountLink account={account} name={name} />
      {children}
    </li>
  );
}

export function FriendsPage() {
  const { indexer } = useServices();
  const me = useVault((s) => s.account);
  const { graph, error, loading, refresh } = useGraph(me);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileSummary[] | undefined>();
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | undefined>();
  const [ignored, setIgnored] = useState<string[]>(() => (me ? ignoredRequests(me) : []));

  const search = async () => {
    const q = query.trim();
    setSearchError(undefined);
    if (q.length === 0) return;
    setSearching(true);
    try {
      if (isAddress(q)) {
        const exact = await indexer.searchProfiles(q, 5);
        setResults(exact.length > 0 ? exact : [{ account: q, owner: q, encryptionKey: "", keyVersion: 0, profileHash: "", profileUri: "", registeredAt: "0", updatedAt: "0" }]);
      } else {
        setResults(await indexer.searchProfiles(q, 20));
      }
    } catch (e) {
      setSearchError(errorMessage(e));
    } finally {
      setSearching(false);
    }
  };

  const incoming = (graph?.pendingIncoming ?? []).filter((r) => !ignored.includes(r.account));
  const hidden = (graph?.pendingIncoming ?? []).filter((r) => ignored.includes(r.account));

  return (
    <div className="page">
      <h1>Friends</h1>
      <Card title="Find people">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <Field label="Address or the start of one" hint="Profiles are looked up through the indexer. Names are stored in profiles and shown once found.">
            {(id) => (
              <div className="row">
                <input id={id} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="1…" autoComplete="off" />
                <Button type="submit" variant="primary" busy={searching}>
                  Search
                </Button>
              </div>
            )}
          </Field>
        </form>
        {searchError && <Notice kind="error">{searchError}</Notice>}
        {results && results.length === 0 && <Empty>No accounts match.</Empty>}
        {results && results.length > 0 && (
          <ul className="list">
            {results.map((r) => (
              <Person key={r.account} account={r.account}>
                <RelationshipActions target={r.account} graph={graph} onChanged={() => void refresh()} compact />
              </Person>
            ))}
          </ul>
        )}
      </Card>
      {error && <Notice kind="error">{error}</Notice>}
      {loading && !graph && <Spinner />}
      <Card title={`Requests (${incoming.length})`}>
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
      </Card>
      <Card title={`Sent requests (${graph?.pendingOutgoing.length ?? 0})`}>
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
      </Card>
      <Card title={`Friends (${graph?.friends.length ?? 0})`}>
        {(graph?.friends.length ?? 0) === 0 ? (
          <Empty>No friends yet. Search for someone above and send a request.</Empty>
        ) : (
          <ul className="list">
            {graph?.friends.map((f) => (
              <Person key={f.account} account={f.account}>
                <RelationshipActions target={f.account} graph={graph} onChanged={() => void refresh()} />
              </Person>
            ))}
          </ul>
        )}
      </Card>
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
    </div>
  );
}
